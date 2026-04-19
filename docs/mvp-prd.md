# Personal Chat Manager MVP PRD

## 1. Product Summary

Personal Chat Manager is a web product that lets a user authorize their own Telegram account, choose which chats should be summarized automatically, and receive incremental AI reports without rereading every message thread manually.

For product language, `chat` or `chat source` should be used as the umbrella term instead of only `group`, because the same workflow may apply to groups, supergroups, and channels.

## 2. MVP Goal

Build the smallest useful version that can:

- Let a user bind one Telegram account
- Discover chats visible to that account
- Let the user enable auto-summary on selected chats
- Schedule recurring summary jobs
- Track the summary cursor for each user-chat binding
- Save and display summary reports
- Give admins visibility into the global chat catalog and system health

## 3. Non-Goals For MVP

- Multiple Telegram accounts per user
- Shared team workspaces
- Cross-chat intelligence or topic clustering
- External delivery channels such as email or Telegram bot push
- Fine-grained admin access to all raw message content
- Custom cron expressions

## 4. Roles

### 4.1 End User

- Registers and signs in to the web product
- Binds one Telegram account
- Views chats available under that account
- Enables or disables automation per chat
- Reviews generated reports

### 4.2 Admin

- Views the global chat catalog
- Views which users have bound which chats
- Views task status, job failures, and account health
- Does not automatically gain permission to inspect all raw message content

## 5. Core User Stories

1. As a user, I want to connect my Telegram account so the product can list the chats I can access.
2. As a user, I want to choose only the chats that matter to me so I do not summarize everything.
3. As a user, I want each chat to remember where the last summary ended so the next summary only covers new messages.
4. As a user, I want to trigger a summary immediately so I can verify the setup without waiting for the next schedule.
5. As an admin, I want to see chat and task health across the system so I can support operations.

## 6. Product Principles

- The product only processes content visible to the Telegram account that the user has authorized.
- `telegram_chats` is a shared metadata table; summary progress is not shared globally.
- The summary cursor belongs to the `user + telegram_account + chat` relationship.
- Raw message retention should be minimized in MVP.
- Admin visibility into system state is separate from raw-content access.

## 7. Core Workflow

1. User signs in to the web product.
2. User binds a Telegram account.
3. System syncs the chats visible to that account.
4. User browses the chat list and enables auto-summary for selected chats.
5. User chooses a frequency, language, summary template, and first-start point.
6. Scheduler runs a background job at the configured time.
7. Worker fetches new messages after the saved cursor.
8. AI generates a structured report.
9. System stores the report and advances the cursor.
10. User reads the report in the web app.

## 8. Page Inventory

### 8.1 Public Pages

#### Login / Register

Purpose:
User authentication for the web product.

Key elements:

- Email and password or third-party login
- Link to create account
- Link to sign in

Primary actions:

- Sign in
- Create account

#### Landing Page

Purpose:
Explain the product value and drive sign-in.

Key elements:

- Product value statement
- How Telegram authorization works
- Privacy and security summary
- CTA to start

### 8.2 Authenticated User Pages

#### Onboarding / Connect Telegram

Purpose:
Help the user bind one Telegram account and complete verification.

Key elements:

- Bind Telegram CTA
- Step guidance for phone verification and 2FA
- Account connection state
- Error states for expired session or failed login

Primary actions:

- Connect Telegram
- Reconnect Telegram
- Disconnect Telegram

#### Chat Source List

Purpose:
Show all chats visible under the connected Telegram account and let the user search, filter, and manage automation.

Key elements:

- Search input
- Filters by type: group, supergroup, channel
- Chat table or list
- Per-chat summary status
- Last summary time
- Last run status
- Enable toggle

Primary actions:

- Open chat configuration
- Enable automation
- Disable automation
- Run summary now

#### Chat Configuration Drawer / Detail Page

Purpose:
Configure summary behavior for one chat source.

Key elements:

- Chat metadata
- Enable toggle
- Summary frequency
- Summary language
- Summary prompt/template selector
- First summary start point
- Current cursor info
- Last run details

Primary actions:

- Save configuration
- Pause automation
- Run now

#### Reports Center

Purpose:
Let the user browse all generated reports across configured chats.

Key elements:

- Report list
- Filters by chat, date range, run status
- Report card metadata

Primary actions:

- Open report detail
- Search reports

#### Report Detail

Purpose:
Display one summary result and its execution context.

Key elements:

- Chat name
- Covered message range
- Generated time
- Structured sections:
  - Key discussion points
  - Decisions
  - Action items
  - Risks or anomalies
  - Important links or mentions

Primary actions:

- Copy report
- Return to chat
- View previous reports for the same chat

#### Account Settings

Purpose:
Manage account, security, and Telegram connection.

Key elements:

- Product profile info
- Telegram account status
- Session health
- Disconnect action
- Data deletion request entry

### 8.3 Admin Pages

#### Admin Dashboard

Purpose:
Observe platform-wide health.

Key elements:

- Bound Telegram accounts count
- Active chat bindings count
- Successful and failed summary jobs
- Accounts needing re-auth

#### Global Chat Catalog

Purpose:
View all discovered chats stored in the shared metadata table.

Key elements:

- Chat title
- Chat type
- External Telegram chat id
- First seen time
- Last synced time
- Number of user bindings

#### Task Runs

Purpose:
Inspect background job execution.

Key elements:

- Run status
- Retry count
- Duration
- Failure reason
- Linked account and chat

## 9. Page-Level Behavior

### 9.1 First Summary Start Point

For MVP, support:

- From now
- From last 24 hours
- From last 7 days

Default:
`From now`

Reason:
This avoids pulling a large amount of historical content on first setup.

### 9.2 Summary Frequency

For MVP, support:

- Manual only
- Every hour
- Every day

### 9.3 Empty and Edge States

- No Telegram account connected
- Telegram session expired
- No chats found
- Chat exists but has no new messages
- Summary run failed due to API or AI error
- Chat was removed, hidden, or no longer accessible to the bound account

## 10. Summary Output Spec

Each report should include:

- Report title
- Chat metadata
- Covered time window or message range
- Executive summary
- Key discussion points
- Decisions
- Action items
- Risks or anomalies
- Important links, files, or mentions

If there are no new messages:

- Do not generate a full report
- Mark the run as `skipped`

## 11. Permission and Privacy Rules

- The product may only read data visible to the user-authorized Telegram account.
- Possessing `api_id` and `api_hash` does not grant access to a Telegram account by itself.
- Telegram session credentials must be encrypted at rest.
- Chat metadata can be stored in a shared catalog table.
- Summary cursor and automation settings must remain scoped to the user binding.
- Raw message storage should be minimized or short-lived in MVP.

## 12. Open Questions Before Build

1. Should channels and groups be enabled together in MVP, or should channels be phase two?
2. Should AI prompts be fixed system templates in MVP, or can users choose from a small list?
3. How long should report history be retained by default?
4. Should admins be able to rerun failed jobs manually?
5. Do we need a user-facing audit trail for reconnect and disconnect events?

## 13. Recommended Build Order

1. Authentication and user model
2. Telegram account binding flow
3. Chat sync and shared chat catalog
4. User-chat bindings and configuration UI
5. Summary job runner and cursor advancement
6. Report storage and report pages
7. Admin dashboard and task visibility
