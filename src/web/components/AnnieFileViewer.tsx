import { useState, useEffect } from "react";
import MDEditor from "@uiw/react-md-editor";
import MermaidMarkdown from "./MermaidMarkdown";
import { apiClient } from "../lib/api";
import { useTheme } from "../contexts/ThemeContext";

interface AnnieFileViewerProps {
	filePath: string;
}

export default function AnnieFileViewer({ filePath }: AnnieFileViewerProps) {
	const { theme } = useTheme();
	const [content, setContent] = useState("");
	const [originalContent, setOriginalContent] = useState("");
	const [isLoading, setIsLoading] = useState(true);
	const [isEditing, setIsEditing] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setIsEditing(false);
		setError(null);
		setIsLoading(true);
		apiClient
			.fetchAnnieFile(filePath)
			.then((result) => {
				setContent(result.content);
				setOriginalContent(result.content);
			})
			.catch((err) => {
				setError(err instanceof Error ? err.message : "Failed to load file");
			})
			.finally(() => {
				setIsLoading(false);
			});
	}, [filePath]);

	const isMarkdown = filePath.endsWith(".md");
	const isHtml = filePath.endsWith(".html") || filePath.endsWith(".htm");
	const hasChanges = content !== originalContent;

	const handleOpenInBrowser = () => {
		window.open(`/api/annie/raw?path=${encodeURIComponent(filePath)}`, "_blank");
	};

	const handleSave = async () => {
		setIsSaving(true);
		try {
			await apiClient.updateAnnieFile(filePath, content);
			setOriginalContent(content);
			setIsEditing(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save file");
		} finally {
			setIsSaving(false);
		}
	};

	const handleCancel = () => {
		setContent(originalContent);
		setIsEditing(false);
	};

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
				Loading...
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex items-center justify-center h-full text-red-500 dark:text-red-400">
				{error}
			</div>
		);
	}

	const breadcrumbs = filePath.split("/");

	return (
		<div className="flex flex-col h-full">
			<div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
				<div className="flex items-center text-sm text-gray-500 dark:text-gray-400 min-w-0">
					<span className="text-gray-400 dark:text-gray-500">.annie</span>
					{breadcrumbs.map((segment, i) => (
						<span key={`${segment}-${i}`} className="flex items-center">
							<span className="mx-1">/</span>
							<span className={i === breadcrumbs.length - 1 ? "text-gray-900 dark:text-gray-100 font-medium truncate" : "truncate"}>
								{segment}
							</span>
						</span>
					))}
				</div>
				<div className="flex items-center space-x-2 ml-4 flex-shrink-0">
					{isEditing ? (
						<>
							<button
								type="button"
								onClick={handleCancel}
								className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleSave}
								disabled={!hasChanges || isSaving}
								className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
							>
								{isSaving ? "Saving..." : "Save"}
							</button>
						</>
					) : (
						<>
							{isHtml && (
								<button
									type="button"
									onClick={handleOpenInBrowser}
									className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
								>
									Open in Browser
								</button>
							)}
							<button
								type="button"
								onClick={() => setIsEditing(true)}
								className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
							>
								Edit
							</button>
						</>
					)}
				</div>
			</div>

			<div className="flex-1 overflow-auto p-6">
				{isMarkdown ? (
					isEditing ? (
						<div className="h-full w-full flex flex-col">
							<div className="flex-1 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800">
								<MDEditor
									value={content}
									onChange={(val) => setContent(val || "")}
									preview="edit"
									height="100%"
									hideToolbar={false}
									data-color-mode={theme}
									textareaProps={{
										placeholder: "Edit file content...",
										style: { fontSize: "14px", resize: "none" },
									}}
								/>
							</div>
						</div>
					) : (
						<div
							className="prose prose-sm !max-w-none w-full p-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
							data-color-mode={theme}
						>
							<MermaidMarkdown source={content} />
						</div>
					)
				) : isEditing ? (
					<textarea
						value={content}
						onChange={(e) => setContent(e.target.value)}
						className="w-full h-full font-mono text-sm p-4 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
				) : (
					<pre className="p-4 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-lg overflow-auto text-sm">
						<code>{content}</code>
					</pre>
				)}
			</div>
		</div>
	);
}
