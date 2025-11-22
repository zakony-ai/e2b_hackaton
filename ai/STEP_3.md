# STEP 3

Handling stream from `const agentStream = responses.create(..)`

We need one type for both
- what will be stored in messages.ndjson
- what will be stored and showed in client UI

Something along these lines
```ts
type ToolCall = {
	id: string;
	name: string;
	arguments: string;
}

type ToolResult ={
  id: string
  content: string
}

type Message
  = { role: "prompt", content: string }
	| { role: "user"; content: string }
	| {
			role: "assistant";
			content: string;
			tool_calls: ToolCall[];
	  };
	| { role: 'tool_result' } & ToolResult
```
The agent turn should aned with "assistant" message that has no tool_calls = [] !
Before that, there can be any numer of assistant messages wit tool_calls (and potentially empty content = "")

Or maybe itse better to have? (have to be decided based on the analysis of events recieved from the agent stream)
```ts
type Message
  = { role: "prompt", content: string }
	| { role: "user"; content: string }
	| { role: "assistant"; content: string; };
	| { role: "tool_call"} & ToolCall
	| { role: 'tool_result' } & ToolResult
```
In this case the llm turn will always end with "assistant" but before that there can be any bumer ot tool_call + tool_results prepended with "assistant" (when llm is telling about what is it doing while making tool calls - some models do that some dont)

So in message.ndjson there will be jsons of type Message and in the clietn state there will be messages: Message[]

Considering the above FE needs to trigger dispatch only actions similar to this:
- ToolCallMade (with complete arguments)
- ToolResultRecieved
- AssistantStartedStreamingText
- AssistantDeltaRecieved
- AssistantStreamDone
- LlmTurnFinished

when AssistatnStartedStreamingText we add "assistant" message to the messages in state, and the on AssistantDelatREcieved we store the chunks in it's .content field (it should always be the last "assistant" message in the array we are streaming to, correct?)
