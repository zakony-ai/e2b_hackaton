read [architectire doc](/ai/ARCHITECTIRE.md)

Implement everything needed for this flow
1. user submits prompt via prompt-input in client/app/page.tsx
2. client saves conversation to array of conversations in localStorage that contain conversation.id (random) and conversation.first_prompt (the prompt user submitted)
3. client calls POST {nextjs_app}/sandbox/create that does what is descriebd in the architecure doc (keep in mind that it has to start the hono server that is built in /server/dist)
4. client gets the agentUrl from the above api call and calls {agentUrl}/agent/talk with the conversation.first_prompt
5. hono server does what is described in the architecture doc 
6. client gets the sse stream and streams it to the UI (above the prompt-input) - do something simple for showing both tool calls and streamed text (we will refine later)
7. client exposes button "Kill {sandboxId}" button that is fixed to the top of the conversation (cannot srcoll it away) - when clicekd it call {nextjs_app}/sandbox/kill which kills the sandbox
