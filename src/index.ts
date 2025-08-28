import * as core from "@actions/core";
import { App, BlockAction, LogLevel } from "@slack/bolt";
import { WebClient } from "@slack/web-api";

const token = process.env.SLACK_BOT_TOKEN || "";
const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
const slackAppToken = process.env.SLACK_APP_TOKEN || "";
const channel_id = process.env.SLACK_CHANNEL_ID || "";
const user_id = process.env.SLACK_USER_ID || "";
const user_email = process.env.SLACK_USER_EMAIL || "";

// Verificando se SLACK_CHANNEL_ID foi fornecido (obrigatório)
if (!channel_id) {
  console.error("Error: SLACK_CHANNEL_ID environment variable is required. Please set it to a valid Slack channel ID.");
  process.exit(1);
}
const unique_step_id = process.env.UNIQUE_STEP_ID || "";
console.log("unique_step_id", unique_step_id);
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

const app = new App({
  token: token,
  signingSecret: signingSecret,
  appToken: slackAppToken,
  socketMode: true,
  port: 3000,
  logLevel: LogLevel.DEBUG,
});

if (minimumApprovalCount > requiredApprovers.length) {
  console.error(
    "Error: Insufficient approvers. Minimum required approvers not met."
  );
  process.exit(1);
}
function hasPayload(inputs: any) {
  return inputs.text?.length > 0 || inputs.blocks?.length > 0;
}

async function run(): Promise<void> {
  try {
    const web = new WebClient(token);
    
    // Função para resolver e-mail para ID de usuário
    async function resolveEmailToUserId(email: string): Promise<string | null> {
      try {
        console.log(`Looking up Slack user ID for email: ${email}`);
        const response = await web.users.lookupByEmail({
          email: email
        });
        
        if (response.ok && response.user && response.user.id) {
          console.log(`Successfully resolved email ${email} to Slack user ID: ${response.user.id}`);
          return response.user.id;
        } else {
          console.warn(`Failed to find Slack user ID for email: ${email}`);
          return null;
        }
      } catch (error) {
        console.error(`Error looking up user by email: ${error}`);
        return null;
      }
    }
    
    // Resolver os e-mails dos aprovadores para IDs de usuário do Slack
    for (const approver of rawApprovers) {
      approver.trim();
      // Se parece um e-mail, tente resolver para ID
      if (approver.includes('@')) {
        console.log(`Approver ${approver} appears to be an email, attempting to resolve to Slack user ID`);
        const userId = await resolveEmailToUserId(approver);
        if (userId) {
          requiredApprovers.push(userId);
          console.log(`Added ${approver} => ${userId} to approvers list`);
        } else {
          console.warn(`Could not resolve email ${approver} to a Slack user ID. This approver won't be able to authorize.`);
        }
      } else {
        // Assumir que é um ID de usuário do Slack
        requiredApprovers.push(approver);
        console.log(`Added direct Slack user ID ${approver} to approvers list`);
      }
    }
    
    // Verificar se há aprovadores válidos após a resolução
    if (requiredApprovers.length === 0) {
      console.error("Error: No valid approvers found. Please check the approvers list and ensure emails can be resolved to Slack user IDs.");
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
                text: `✅ Approve (${remainingApprovals} needed)`,
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
                text: "❌ Reject",
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
          console.log(`Found user ID ${response.user.id} for email ${email}`);
          return response.user.id;
        } else {
          console.warn(`Failed to find user with email ${email}`);
          return null;
        }
      } catch (error) {
        console.error(`Error looking up user by email: ${error}`);
        return null;
      }
    }

    // Função para obter o ID do canal da mensagem direta
    async function getDirectMessageChannel(userID: string) {
      if (!userID) {
        console.log("No user ID provided. Using channel instead.");
        return channel_id; // Volta para o canal do grupo se o ID do usuário não estiver disponível
      }

      try {
        // Verifica se o bot tem as permissões necessárias
        console.log(`Attempting to open direct message with user: ${userID}`);

        // Abre uma conversa direta com o usuário
        const conversationResponse = await web.conversations.open({
          users: userID
        });

        if (conversationResponse.ok && conversationResponse.channel?.id) {
          console.log(`Successfully opened direct message channel: ${conversationResponse.channel.id}`);
          return conversationResponse.channel.id;
        } else {
          console.warn(`Failed to open direct message channel: ${JSON.stringify(conversationResponse.error || "Unknown error")}`);
          console.warn("Make sure your Slack app has the 'im:write' scope enabled");
          console.warn("Falling back to group channel");
          return channel_id;
        }
      } catch (error) {
        console.error(`Error opening direct message: ${error}`);
        console.warn("This may be due to missing 'im:write' scope. Please add this scope to your Slack app");
        console.warn("Falling back to group channel:", channel_id);
        return channel_id; // Volta para o canal do grupo em caso de erro
      }
    }

    // Tentar obter o ID do usuário pelo e-mail se não fornecido diretamente
    let finalUserId = user_id;
    if (!finalUserId && user_email) {
      console.log(`Trying to find user ID for email: ${user_email}`);
      const emailLookupResult = await getUserIdByEmail(user_email);
      if (emailLookupResult) {
        finalUserId = emailLookupResult;
        console.log(`Successfully resolved email ${user_email} to user ID ${finalUserId}`);
      } else {
        console.warn(`Could not resolve email ${user_email} to a Slack user ID. Falling back to channel.`);
      }
    }

    // Verificar se o canal do grupo existe
    try {
      await web.conversations.info({
        channel: channel_id
      });
      console.log(`Channel ${channel_id} exists and is accessible.`);
    } catch (error) {
      console.error(`Error: The fallback channel ${channel_id} does not exist or bot doesn't have access to it. Please ensure the SLACK_CHANNEL_ID is correct and the bot is invited to the channel.`);
      console.error(`Error details: ${error}`);
      process.exit(1);
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

              await client.chat.update({
                ts: mainMessage.ts || "",
                channel: channelId || targetChannelId,
                ...(hasPayload(successMessagePayload)
                  ? successMessagePayload
                  : mainMessagePayload),
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
            await client.chat.update({
              ts: mainMessage.ts || "",
              channel: channelId || targetChannelId,
              ...(hasPayload(failMessagePayload) ? failMessagePayload : {
                text: `❌ Request rejected by <@${userId}>`,
                blocks: [
                  ...mainMessagePayload.blocks.slice(0, -2),
                  {
                    type: "section",
                    text: {
                      type: "mrkdwn",
                      text: `❌ *Request Rejected*\nRejected by <@${userId}> on ${new Date().toLocaleString()}`,
                    },
                  },
                ],
              }),
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
      console.log("Waiting Approval reaction.....");
    })();
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

run();
