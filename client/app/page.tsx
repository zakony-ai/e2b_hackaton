"use client";
import { Button } from "@/components/ui/button";

export default function Home() {
	return (
		<div className="flex min-h-screen items-center justify-center">
			<div className="flex flex-col items-center gap-4">
				<h1 className="text-4xl font-bold">Welcome</h1>
				<Button
					onClick={() => {
						console.log("Button clicked");
					}}
					variant="secondary"
				>
					Click me
				</Button>
			</div>
		</div>
	);
}
