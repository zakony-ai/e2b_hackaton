"use client";
import {
	ResizablePanelGroup,
	ResizablePanel,
	ResizableHandle,
} from "@/components/ui/resizable";
import {
	PromptInput,
	PromptInputBody,
	PromptInputTextarea,
	PromptInputFooter,
	PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";

export default function Home() {
	return (
		<div className="h-screen w-full">
			<ResizablePanelGroup direction="horizontal">
				<ResizablePanel defaultSize={10} minSize={5}>
					<div className="h-full p-4">
						<h2 className="font-semibold text-lg">Left Panel</h2>
					</div>
				</ResizablePanel>

				<ResizableHandle />

				<ResizablePanel defaultSize={60} minSize={30}>
					<div className="flex h-full flex-col p-4">
						<h2 className="mb-4 font-semibold text-lg">Middle Panel</h2>
						<div className="flex-1" />
						<PromptInput
							onSubmit={(message) => {
								console.log("Submitted:", message);
							}}
						>
							<PromptInputBody>
								<PromptInputTextarea placeholder="Type your message here..." />
							</PromptInputBody>
							<PromptInputFooter>
								<div />
								<PromptInputSubmit />
							</PromptInputFooter>
						</PromptInput>
					</div>
				</ResizablePanel>

				<ResizableHandle />

				<ResizablePanel defaultSize={30} minSize={15}>
					<div className="h-full p-4">
						<h2 className="font-semibold text-lg">Right Panel</h2>
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}
