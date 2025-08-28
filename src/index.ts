import * as core from "@actions/core";
import { App, BlockAction, LogLevel } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import chalk from "chalk";

// Sistema de logging aprimorado
const logger = {
  info: (message: string, ...args: any[]) => {
    console.log(chalk.blue.bold(`[INFO] `) + chalk.blue(message), ...args);
  },
  success: (message: string, ...args: any[]) => {
    console.log(chalk.green.bold(`[SUCCESS] `) + chalk.green(message), ...args);
  },
  warn: (message: string, ...args: any[]) => {
    console.warn(chalk.yellow.bold(`[WARNING] `) + chalk.yellow(message), ...args);
  },
  error: (message: string, ...args: any[]) => {
    console.error(chalk.red.bold(`[ERROR] `) + chalk.red(message), ...args);
  },
  debug: (message: string, ...args: any[]) => {
    if (isDebugMode) {
      console.log(chalk.magenta.bold(`[DEBUG] `) + chalk.magenta(message), ...args);
    }
  }
};

const token = process.env.SLACK_BOT_TOKEN || "";
const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
const slackAppToken = process.env.SLACK_APP_TOKEN || "";
const channel_id = process.env.SLACK_CHANNEL_ID || "";
const user_id = process.env.SLACK_USER_ID || "";
const user_email = process.env.SLACK_USER_EMAIL || "";

// Configuração de debug
const isDebugMode = core.getInput("debug").toLowerCase() === "true";

// Verificando se pelo menos uma opção de destino foi fornecida
if (!channel_id && !user_id && !user_email) {
  logger.error("No target destination provided. Please set at least one of SLACK_CHANNEL_ID, SLACK_USER_ID, or SLACK_USER_EMAIL.");
  process.exit(1);
}
const unique_step_id = process.env.UNIQUE_STEP_ID || "";
logger.info(`Initializing approval process with ID: ${unique_step_id}`);
const baseMessageTs = core.getInput("baseMessageTs");
// Lista original de aprovadores (pode conter IDs ou e-mails)
const rawApprovers = core
  .getInput("approvers", { required: true, trimWhitespace: true })
  ?.split(",");

// Array para armazenar os IDs dos aprovadores (serão preenchidos posteriormente)
const requiredApprovers: string[] = [];

const minimumApprovalCount = Number(core.getInput("minimumApprovalCount")) || 1;
const baseMessagePayload = JSON.parse(
  core.getMultilineInput("baseMessagePayload").join("")
);

// Array para armazenar os IDs dos usuários que já aprovaram
const approvers: string[] = [];

const successMessagePayload = JSON.parse(
  core.getMultilineInput("successMessagePayload").join("")
);
const failMessagePayload = JSON.parse(
  core.getMultilineInput("failMessagePayload").join("")
);

// Textos personalizados para os botões
const approveButtonText = core.getInput("approveButtonText") || "✅ Approve";
const rejectButtonText = core.getInput("rejectButtonText") || "❌ Reject";

const app = new App({
  token: token,
  signingSecret: signingSecret,
  appToken: slackAppToken,
  socketMode: true,
  port: 3000,
  logLevel: isDebugMode ? LogLevel.DEBUG : LogLevel.ERROR,
});

// A verificação de número mínimo de aprovadores será feita depois de resolver os e-mails para IDs
function hasPayload(inputs: any) {
  return inputs.text?.length > 0 || inputs.blocks?.length > 0;
}

async function run(): Promise<void> {
  try {
    const web = new WebClient(token);

    // Função para resolver e-mail para ID de usuário
    async function resolveEmailToUserId(email: string): Promise<string | null> {
      try {
        logger.debug(`Looking up Slack user ID for email: ${email}`);
        const response = await web.users.lookupByEmail({
          email: email
        });

        if (response.ok && response.user && response.user.id) {
          logger.success(`Successfully resolved email ${email} to Slack user ID: ${response.user.id}`);
          return response.user.id;
        } else {
          logger.warn(`Failed to find Slack user ID for email: ${email}`);
          return null;
        }
      } catch (error) {
        logger.error(`Error looking up user by email: ${error}`);
        return null;
      }
    }

    // Resolver os e-mails dos aprovadores para IDs de usuário do Slack
    for (const approver of rawApprovers) {
      approver.trim();
      // Se parece um e-mail, tente resolver para ID
      if (approver.includes('@')) {
        logger.info(`Approver ${approver} appears to be an email, attempting to resolve to Slack user ID`);
        const userId = await resolveEmailToUserId(approver);
        if (userId) {
          requiredApprovers.push(userId);
          logger.success(`Added ${approver} => ${userId} to approvers list`);
        } else {
          logger.warn(`Could not resolve email ${approver} to a Slack user ID. This approver won't be able to authorize.`);
        }
      } else {
        // Assumir que é um ID de usuário do Slack
        requiredApprovers.push(approver);
        logger.debug(`Added direct Slack user ID ${approver} to approvers list`);
      }
    }

    // Verificar se há aprovadores válidos após a resolução
    if (requiredApprovers.length === 0) {
      logger.error("No valid approvers found. Please check the approvers list and ensure emails can be resolved to Slack user IDs.");
      process.exit(1);
    }

    // Verificar se o número mínimo de aprovadores é válido
    if (minimumApprovalCount > requiredApprovers.length) {
      logger.error(
        `Insufficient approvers. Minimum required approvers (${minimumApprovalCount}) not met. Only ${requiredApprovers.length} valid approver(s) found.`
      );
      logger.info(`Valid approvers: ${requiredApprovers.join(", ")}`);
      process.exit(1);
    }

    const github_server_url = process.env.GITHUB_SERVER_URL || "";
    const github_repos = process.env.GITHUB_REPOSITORY || "";
    const run_id = process.env.GITHUB_RUN_ID || "";
    const run_number = process.env.GITHUB_RUN_NUMBER || "";
    const run_attempt = process.env.GITHUB_RUN_ATTEMPT || "";
    const workflow = process.env.GITHUB_WORKFLOW || "";
    const aid = `${github_repos}-${workflow}-${run_id}-${run_number}-${run_attempt}`;
    const runnerOS = process.env.RUNNER_OS || "";
    const actor = process.env.GITHUB_ACTOR || "";
    const actionsUrl = `${github_server_url}/${github_repos}/actions/runs/${run_id}`;

    const renderApprovalStatus = () => {
      return {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Required Approvers Count:* ${minimumApprovalCount}\n*Remaining Approvers:* ${requiredApprovers
            .map((v) => `<@${v}>`)
            .join(", ")}\n${approvers.length > 0
              ? `Approvers: ${approvers.map((v) => `<@${v}>`).join(", ")} `
              : ""
            }\n`,
        },
      };
    };

    const renderApprovalButtons = () => {
      const remainingApprovals = minimumApprovalCount - approvers.length;
      const isFullyApproved = approvers.length >= minimumApprovalCount;

      if (!isFullyApproved) {
        return {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                emoji: true,
                text: `${approveButtonText} (${remainingApprovals} needed)`,
              },
              style: "primary",
              value: aid,
              action_id: `slack-approval-approve-${unique_step_id}`,
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                emoji: true,
                text: rejectButtonText,
              },
              style: "danger",
              value: aid,
              action_id: `slack-approval-reject-${unique_step_id}`,
            },
          ],
        };
      }

      return {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🎉 *Approval Complete!* All ${minimumApprovalCount} required approvals have been received.`,
        },
      };
    };

    const mainMessagePayload = hasPayload(baseMessagePayload)
      ? {
        ...baseMessagePayload,
        text: baseMessagePayload.text || "GitHub Actions Approval Request #${unique_step_id}",
        blocks: [...baseMessagePayload.blocks, renderApprovalStatus(), renderApprovalButtons()]
      }
      : {
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "GitHub Actions Approval Request",
            },
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*GitHub Actor:*\n${actor}`,
              },
              {
                type: "mrkdwn",
                text: `*Repos:*\n${github_server_url}/${github_repos}`,
              },
              {
                type: "mrkdwn",
                text: `*Actions URL:*\n${actionsUrl}`,
              },
              {
                type: "mrkdwn",
                text: `*GITHUB_RUN_ID:*\n${run_id}`,
              },
              {
                type: "mrkdwn",
                text: `*Workflow:*\n${workflow}`,
              },
              {
                type: "mrkdwn",
                text: `*RunnerOS:*\n${runnerOS}`,
              },
            ],
          },
          renderApprovalStatus(),
          renderApprovalButtons(),
        ],
      };

    function approve(userId: string) {
      const idx = requiredApprovers.findIndex((user) => user === userId);
      if (idx === -1) {
        return "notApproval";
      }
      requiredApprovers.splice(idx, 1);
      approvers.push(userId);

      if (approvers.length < minimumApprovalCount) {
        return "remainApproval";
      }

      return "approved";
    }

    // Função para buscar o ID do usuário pelo e-mail
    async function getUserIdByEmail(email: string): Promise<string | null> {
      if (!email) {
        return null;
      }

      try {
        const response = await web.users.lookupByEmail({
          email: email
        });

        if (response.ok && response.user && response.user.id) {
          logger.debug(`Found user ID ${response.user.id} for email ${email}`);
          return response.user.id;
        } else {
          logger.warn(`Failed to find user with email ${email}`);
          return null;
        }
      } catch (error) {
        logger.error(`Error looking up user by email: ${error}`);
        return null;
      }
    }

    // Função para obter o ID do canal da mensagem direta
    async function getDirectMessageChannel(userID: string) {
      if (!userID) {
        if (channel_id) {
          logger.info("No user ID provided. Using channel instead.");
          return channel_id; // Volta para o canal do grupo se o ID do usuário não estiver disponível e um canal foi configurado
        } else {
          logger.error("No user ID could be resolved and no fallback channel provided. Unable to send message.");
          process.exit(1);
        }
      }

      try {
        // Verifica se o bot tem as permissões necessárias
        logger.info(`Attempting to open direct message with user: ${userID}`);

        // Abre uma conversa direta com o usuário
        const conversationResponse = await web.conversations.open({
          users: userID
        });

        if (conversationResponse.ok && conversationResponse.channel?.id) {
          logger.success(`Successfully opened direct message channel: ${conversationResponse.channel.id}`);
          return conversationResponse.channel.id;
        } else {
          logger.warn(`Failed to open direct message channel: ${JSON.stringify(conversationResponse.error || "Unknown error")}`);
          logger.warn("Make sure your Slack app has the 'im:write' scope enabled");
          if (channel_id) {
            logger.warn("Falling back to group channel");
            return channel_id;
          } else {
            logger.error("No fallback channel provided. Unable to send message.");
            process.exit(1);
          }
        }
      } catch (error) {
        logger.error(`Error opening direct message: ${error}`);
        logger.warn("This may be due to missing 'im:write' scope. Please add this scope to your Slack app");
        if (channel_id) {
          logger.warn(`Falling back to group channel: ${channel_id}`);
          return channel_id; // Volta para o canal do grupo em caso de erro se um canal foi configurado
        } else {
          logger.error("No fallback channel provided. Unable to send message.");
          process.exit(1);
        }
      }
    }

    // Tentar obter o ID do usuário pelo e-mail se não fornecido diretamente
    let finalUserId = user_id;
    if (!finalUserId && user_email) {
      logger.info(`Trying to find user ID for email: ${user_email}`);
      const emailLookupResult = await getUserIdByEmail(user_email);
      if (emailLookupResult) {
        finalUserId = emailLookupResult;
        logger.success(`Successfully resolved email ${user_email} to user ID ${finalUserId}`);
      } else {
        logger.warn(`Could not resolve email ${user_email} to a Slack user ID. Falling back to channel.`);
      }
    }

    // Verificar se o canal do grupo existe (se foi fornecido)
    if (channel_id) {
      try {
        await web.conversations.info({
          channel: channel_id
        });
        logger.info(`Channel ${channel_id} exists and is accessible.`);
      } catch (error) {
        logger.error(`The fallback channel ${channel_id} does not exist or bot doesn't have access to it. Please ensure the SLACK_CHANNEL_ID is correct and the bot is invited to the channel.`);
        logger.debug(`Error details: ${error}`);
        // Só vamos sair se não tivermos um ID de usuário válido, pois podemos tentar enviar diretamente sem usar o canal
        if (!finalUserId) {
          process.exit(1);
        } else {
          logger.warn("Invalid channel but user ID is available. Will attempt to send direct message without fallback channel.");
        }
      }
    } else {
      logger.info("No channel ID provided. Using direct messages only without fallback.");
    }

    // Determinar o canal para enviar a mensagem (DM para usuário ou canal do grupo)
    const targetChannelId = finalUserId ? await getDirectMessageChannel(finalUserId) : channel_id;

    const mainMessage = baseMessageTs
      ? await web.chat.update({
        channel: targetChannelId,
        ts: baseMessageTs,
        ...mainMessagePayload,
      })
      : await web.chat.postMessage({
        channel: targetChannelId,
        ...mainMessagePayload,
      });

    core.setOutput("mainMessageTs", mainMessage.ts);

    async function cancelHandler() {
      await web.chat.update({
        ts: mainMessage.ts!,
        channel: targetChannelId,
        ...(hasPayload(failMessagePayload) ? failMessagePayload : mainMessagePayload),
      });
      process.exit(1);
    }

    process.on("SIGTERM", cancelHandler);
    process.on("SIGINT", cancelHandler);
    process.on("SIGBREAK", cancelHandler);

    app.action(
      `slack-approval-approve-${unique_step_id}`,
      async ({ ack, client, body, logger, action }) => {
        try {
          await ack();

          // Validate action type
          if (action.type !== "button") {
            logger.warn(`Invalid action type: ${action.type}`);
            return;
          }

          // Validate action value
          if (action.value !== aid) {
            logger.warn(`Invalid action value: ${action.value}, expected: ${aid}`);
            return;
          }

          const userId = body.user?.id;
          const userName = (body.user as any)?.name || (body.user as any)?.username || 'Unknown User';
          const channelId = body.channel?.id;

          logger.info(`Approval request from user: ${userName} (${userId}) in channel: ${channelId}`);

          // Check if user is authorized to approve
          if (!userId) {
            logger.error("No user ID found in request body");
            return;
          }

          // Check if user has already approved
          if (approvers.includes(userId)) {
            logger.info(`User ${userName} (${userId}) has already approved`);

            // Send ephemeral message to user
            await client.chat.postEphemeral({
              channel: channelId || "",
              user: userId,
              text: "You have already approved this request.",
            });
            return;
          }

          // Check if user is in the required approvers list
          if (!requiredApprovers.includes(userId)) {
            logger.warn(`Unauthorized approval attempt by user: ${userName} (${userId})`);

            // Send ephemeral message to user
            await client.chat.postEphemeral({
              channel: channelId || "",
              user: userId,
              text: "You are not authorized to approve this request.",
            });
            return;
          }

          const approveResult = approve(userId);
          logger.info(`Approval result for ${userName}: ${approveResult}`);

          // Update the main message
          try {
            if (approveResult === "approved") {
              logger.info(`Request fully approved by ${userName}. Exiting with success.`);

              // Criar uma mensagem de sucesso personalizada que inclui o status de aprovação e uma mensagem de confirmação
              const successBlocks = hasPayload(successMessagePayload)
                ? [...successMessagePayload.blocks || [], {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `🎉 *Approval Complete!* All ${minimumApprovalCount} required approvals have been received.\nApproved by ${approvers.map((v) => `<@${v}>`).join(", ")} on ${new Date().toLocaleString()}`
                  }
                }]
                : [
                  ...mainMessagePayload.blocks.slice(0, -2),
                  {
                    type: "section",
                    text: {
                      type: "mrkdwn",
                      text: `🎉 *Approval Complete!* All ${minimumApprovalCount} required approvals have been received.\nApproved by ${approvers.map((v) => `<@${v}>`).join(", ")} on ${new Date().toLocaleString()}`
                    }
                  }
                ];

              await client.chat.update({
                ts: mainMessage.ts || "",
                channel: channelId || targetChannelId,
                text: "GitHub Actions Approval Request - APPROVED",
                blocks: successBlocks
              });

            } else if (approveResult === "remainApproval") {
              logger.info(`Partial approval by ${userName}. ${minimumApprovalCount - approvers.length} more approvals needed.`);

              await client.chat.update({
                channel: channelId || targetChannelId,
                ts: mainMessage?.ts || "",
                text: "",
                blocks: [
                  ...mainMessagePayload.blocks.slice(0, -2),
                  renderApprovalStatus(),
                  renderApprovalButtons(),
                ],
              });

            } else {
              logger.warn(`Unexpected approval result: ${approveResult}`);
            }
          } catch (updateError) {
            logger.error(`Failed to update message: ${updateError}`);

            // Send error notification to user
            await client.chat.postEphemeral({
              channel: channelId || "",
              user: userId,
              text: "❌ Failed to update the approval message. Please try again.",
            });
          }

          // Exit if fully approved
          if (approveResult === "approved") {
            process.exit(0);
          }

        } catch (error) {
          logger.error(`Error in approval action handler: ${error}`);

          // Try to send error notification to user if possible
          try {
            const userId = body.user?.id;
            const channelId = body.channel?.id;

            if (userId && channelId) {
              await client.chat.postEphemeral({
                channel: channelId,
                user: userId,
                text: "❌ An error occurred while processing your approval. Please try again.",
              });
            }
          } catch (ephemeralError) {
            logger.error(`Failed to send error notification: ${ephemeralError}`);
          }
        }
      }
    );

    app.action(
      `slack-approval-reject-${unique_step_id}`,
      async ({ ack, client, body, logger, action }) => {
        try {
          await ack();

          // Validate action type
          if (action.type !== "button") {
            logger.warn(`Invalid reject action type: ${action.type}`);
            return;
          }

          // Validate action value
          if (action.value !== aid) {
            logger.warn(`Invalid reject action value: ${action.value}, expected: ${aid}`);
            return;
          }

          const userId = body.user?.id;
          const userName = (body.user as any)?.name || (body.user as any)?.username || 'Unknown User';
          const channelId = body.channel?.id;

          logger.info(`Rejection request from user: ${userName} (${userId}) in channel: ${channelId}`);

          // Check if user ID exists
          if (!userId) {
            logger.error("No user ID found in reject request body");
            return;
          }

          // Check if user is authorized to reject (anyone in required approvers can reject)
          if (!requiredApprovers.includes(userId) && !approvers.includes(userId)) {
            logger.warn(`Unauthorized rejection attempt by user: ${userName} (${userId})`);

            // Send ephemeral message to user
            await client.chat.postEphemeral({
              channel: channelId || "",
              user: userId,
              text: "You are not authorized to reject this request.",
            });
            return;
          }

          // Check if request is already fully approved
          if (approvers.length >= minimumApprovalCount) {
            logger.info(`Rejection attempt by ${userName} after request was already approved`);

            // Send ephemeral message to user
            await client.chat.postEphemeral({
              channel: channelId || "",
              user: userId,
              text: "This request has already been approved and cannot be rejected.",
            });
            return;
          }

          logger.info(`Request rejected by ${userName}. Exiting with failure.`);

          // Update the main message with rejection
          try {
            const rejectionBlocks = hasPayload(failMessagePayload)
              ? [...failMessagePayload.blocks || [], {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `❌ *Request Rejected*\nRejected by <@${userId}> on ${new Date().toLocaleString()}`,
                },
              }]
              : [
                ...mainMessagePayload.blocks.slice(0, -2),
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `❌ *Request Rejected*\nRejected by <@${userId}> on ${new Date().toLocaleString()}`,
                  },
                },
              ];

            await client.chat.update({
              ts: mainMessage.ts || "",
              channel: channelId || targetChannelId,
              text: "GitHub Actions Approval Request - REJECTED",
              blocks: rejectionBlocks,
            });

          } catch (updateError) {
            logger.error(`Failed to update message with rejection: ${updateError}`);

            // Send error notification to user
            await client.chat.postEphemeral({
              channel: channelId || "",
              user: userId,
              text: "❌ Failed to update the rejection message. The request will still be rejected.",
            });
          }

          // Exit with failure code
          process.exit(1);

        } catch (error) {
          logger.error(`Error in rejection action handler: ${error}`);

          // Try to send error notification to user if possible
          try {
            const userId = body.user?.id;
            const channelId = body.channel?.id;

            if (userId && channelId) {
              await client.chat.postEphemeral({
                channel: channelId,
                user: userId,
                text: "❌ An error occurred while processing your rejection. Please try again.",
              });
            }
          } catch (ephemeralError) {
            logger.error(`Failed to send error notification: ${ephemeralError}`);
          }

          // Still exit with failure even if there was an error
          process.exit(1);
        }
      }
    );

    (async () => {
      await app.start(3000);
      logger.info("Waiting for approval reaction...");
      logger.info(`Debug mode: ${isDebugMode ? "enabled" : "disabled"}`);
      
      if (isDebugMode) {
        logger.debug("Debug information:");
        logger.debug(`- Unique step ID: ${unique_step_id}`);
        logger.debug(`- Required approvers: ${requiredApprovers.join(", ")}`);
        logger.debug(`- Minimum approval count: ${minimumApprovalCount}`);
        logger.debug(`- Target channel: ${channel_id || "None (using direct messages)"}`);
      }
    })();
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

run();
