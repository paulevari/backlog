import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiClient, type AnnieTreeNode } from "../lib/api";
import AnnieFileTree from "./AnnieFileTree";
import AnnieFileViewer from "./AnnieFileViewer";

export default function AnnieFileBrowser() {
	const params = useParams();
	const navigate = useNavigate();
	const [tree, setTree] = useState<AnnieTreeNode | null>(null);
	const [exists, setExists] = useState(true);
	const [isLoading, setIsLoading] = useState(true);

	const selectedPath = params["*"] || null;

	useEffect(() => {
		apiClient
			.fetchAnnieTree()
			.then((result) => {
				setExists(result.exists);
				setTree(result.tree);
			})
			.catch(() => {
				setExists(false);
			})
			.finally(() => {
				setIsLoading(false);
			});
	}, []);

	const handleSelectFile = (path: string) => {
		navigate(`/annie/${path}`);
	};

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
				Loading...
			</div>
		);
	}

	if (!exists || !tree) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="text-center">
					<p className="text-gray-500 dark:text-gray-400 text-lg">No .annie directory found</p>
					<p className="text-gray-400 dark:text-gray-500 text-sm mt-2">
						Agent files will appear here when a .annie directory exists in your project.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full">
			<div className="w-72 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col overflow-hidden">
				<div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
					<h2 className="text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
						Agent Files
					</h2>
				</div>
				<div className="flex-1 overflow-y-auto p-2">
					<AnnieFileTree tree={tree} selectedPath={selectedPath} onSelectFile={handleSelectFile} />
				</div>
			</div>

			<div className="flex-1 min-w-0 bg-gray-50 dark:bg-gray-900">
				{selectedPath ? (
					<AnnieFileViewer filePath={selectedPath} />
				) : (
					<div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
						Select a file to view
					</div>
				)}
			</div>
		</div>
	);
}
