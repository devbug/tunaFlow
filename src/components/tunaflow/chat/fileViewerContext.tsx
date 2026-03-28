import { createContext, useContext } from "react";

interface FileViewerContextValue {
  openFile: (path: string, line?: number) => void;
}

export const FileViewerContext = createContext<FileViewerContextValue | null>(null);

export function useFileViewer() {
  return useContext(FileViewerContext);
}
