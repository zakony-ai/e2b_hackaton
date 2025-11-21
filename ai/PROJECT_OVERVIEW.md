# Science research collaborator

## Technical overview
- typescript
- pnpm
- nextjs
- spinning up kimi-k2 (via groq) in in r2b container, see [mcp groq exa example](https://github.com/e2b-dev/e2b-cookbook/blob/main/examples/mcp-groq-exa-js/index.ts)
  - need to analyze:
    - **e2b containers initiated by nextj server actions**: is this possible via server actions? can the serverless action spin the e2b container with the kimi k2 agent and just pass the UI the connection so the serverless function can die than and agent lives on i nthe container?
    - **when to kill the e2b container**: is there a best practice on how to handle this when building agents inside e2b containers? or multiple ones with trafeoffs? lets research and compare
    - **storing state**: 
      - if user refresehs the UI, we would lose the conenction to the e2b container? Can we store it in the local storage so we dont have to ahve a DB? Can we have DB like experience via local-storage/browswe to also store the conversations and etc. - is this more hussle that hosting a DB or viable solution?
      - would it be better to just kill the e2b container when the FE session disconnects (suer closes/refreshes the browser tab) so we dont have to keep the connection handle somewhere on the FE or db - is this possible - how?
    - **agentic loop**: would it be better to 
      - just user responses api and get agentic loop "for free" and if user has a folow up we spin up a new e2b container while passing the convo history. this means we can kill the e2b container when the responses api responds and we send the info to FE?
      - write or reuse some existing (research what would be good) basic agentic loop that enables user followups and only kill the container. This menas we can kil the e2b container when there is no followup prompt for some time, or only after user closes the broswer - or both?
- mcps to use 
  - for research 
    - start with [arXiv mcp](https://hub.docker.com/mcp/server/arxiv-mcp-server/overview) 
    - later we might to more complex [paper search mcp](https://hub.docker.com/mcp/server/paper-search/overview)
