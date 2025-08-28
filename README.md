# slack-approval

custom action to send approval request to Slack


## trigger
<image src="img/approve_at_reply.png" width="800" height="300" />

- When action is triggered, Post or Update in Slack, a reply message appears simultaneously with "Approve" and "Reject" buttons
## approve
<image src="img/approved.png" width="800" height="100" />

- Clicking on "Approve" will execute next steps

## reject and cancel
<image src="img/rejected.png" width="800" height="100" />
<image src="img/canceled.png" width="800" height="100" />

- Clicking on "Reject" or "cancel workflow" will cause workflow to fail and update reply message





# How To Use

- First, create a Slack App and install in your workspace.
- Second. set the `App Manifest`
```json
{
    "display_information": {
        "name": "ApprveApp"
    },
    "features": {
        "bot_user": {
            "display_name": "ApproveApp",
            "always_online": false
        }
    },
    "oauth_config": {
        "scopes": {
            "bot": [
                "app_mentions:read",
                "channels:join",
                "chat:write",
                "users:read",
                "users:read.email", 
                "im:write"
            ]
        }
    },
    "settings": {
        "interactivity": {
            "is_enabled": true
        },
        "org_deploy_enabled": false,
        "socket_mode_enabled": true,
        "token_rotation_enabled": false
    }
}
```

- set workflow step
```yaml
jobs:
  approval:
    runs-on: ubuntu-latest
    steps:
      - name: send approval
        uses: elitenomad/slack-approval@v1.0.3
        env:
          SLACK_APP_TOKEN: ${{ secrets.SLACK_APP_TOKEN }}
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          SLACK_SIGNING_SECRET: ${{ secrets.SLACK_SIGNING_SECRET }}
          # Opções de destino (pelo menos uma é necessária):
          # SLACK_CHANNEL_ID: ${{ secrets.SLACK_CHANNEL_ID }} # Canal do Slack (opcional com mensagens diretas)
          SLACK_USER_EMAIL: ${{ secrets.SLACK_USER_EMAIL }} # Email do usuário (recomendado)
          # SLACK_USER_ID: ${{ secrets.SLACK_USER_ID }} # ID do usuário (alternativa)
          UNIQUE_STEP_ID: "1234"
        timeout-minutes: 5
        with:
            approvers: U12345678,user.name@example.com
            minimumApprovalCount: 2
            baseMessagePayload: |
              {}
            successMessagePayload: |
              {}
            failMessagePayload: |
              {}
```

## Set environment variables

  - `SLACK_APP_TOKEN`

    - App-level tokens on `Basic Information page`. (starting with `xapp-` )

  - `SLACK_BOT_TOKEN`

    - Bot-level tokens on `OAuth & Permissions page`. (starting with `xoxb-` )

  - `SLACK_SIGNING_SECRET`

    - Signing Secret on `Basic Information page`.

  - `SLACK_CHANNEL_ID`, `SLACK_USER_ID` ou `SLACK_USER_EMAIL` (use apenas uma destas opções)

    - `SLACK_CHANNEL_ID`: Channel ID for which you want to send approval. Optional when using direct messages, but recommended as a fallback if direct messages fail.
    - `SLACK_USER_ID`: User ID to send direct message approval.
    - `SLACK_USER_EMAIL`: Email address of the Slack user to send direct message approval. The app will automatically lookup the user ID based on this email. **REQUIRES ADDITIONAL SCOPES**: You must add `users:read.email` and `im:write` scopes to your Slack app for this feature to work.
    
    Note: At least one of these three options must be provided.

  - `UNIQUE_STEP_ID`

    - UNIQUE ID to differentiate the value of the html input elements

## Set Inputs

  - `baseMessageTs`
    - If provided, updates the target message. If not provided, creates a new message
    - Optional

  - `approvers`
    - A comma-separated list of approvers' Slack user IDs or email addresses
    - When using email addresses, the app will automatically convert them to Slack user IDs (requires the `users:read.email` scope)
    - Required

  - `minimumApprovalCount`
    - The minimum number of approvals required
    - Optional (default: "1")

  - `baseMessagePayload`
    - The base message payload to display. If not set, will use default message from README. To customize, provide Slack message payload JSON
    - Optional (default: "{}")

  - `successMessagePayload`
    - The message body indicating approval is success. If not set, will use baseMessagePayload.
    - Optional (default: "{}")

  - `failMessagePayload`
    - The message body indicating approval is fail. If not set, will use baseMessagePayload.
    - Optional (default: "{}")


## outputs

- `mainMessageTs`
  - Timestamp of the main message sent to Slack

