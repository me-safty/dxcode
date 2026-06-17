import { useState } from "react";
import { FolderIcon } from "lucide-react";
import type { Student } from "@t3tools/contracts";
import { deriveStudentSlug } from "@t3tools/contracts";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { cn } from "~/lib/utils";

export interface StudentDetailProps {
  student: Student;
  className?: string;
}

/**
 * Student detail view component showing name, subjects, school.
 * Includes [Generate materials] action button that:
 * 1. Calls localApi.materials.ensureStudentWorkspace to create/ensure workspace folder
 * 2. Registers workspace as a project
 * 3. Starts a new session/thread rooted at the student's materials folder
 */
export function StudentDetail({ student, className }: StudentDetailProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const { handleNewThread, defaultProjectRef } = useHandleNewThread();

  const handleGenerateMaterials = async () => {
    if (!window.desktopBridge) {
      toastManager.add({
        title: "Desktop app required",
        description: "Materials workspace is only available in the desktop app.",
        type: "error",
      });
      return;
    }

    if (!defaultProjectRef) {
      toastManager.add({
        title: "No project available",
        description: "No environment or project is configured. Please set up a project first.",
        type: "error",
      });
      return;
    }

    setIsGenerating(true);

    try {
      // 1. Create/ensure workspace folder
      const slug = deriveStudentSlug(student.name);
      const result = await window.desktopBridge.ensureStudentWorkspace({
        studentId: student.id,
      });

      if (!result.success || !result.workspacePath) {
        throw new Error(result.error || "Failed to create workspace");
      }

      toastManager.add({
        title: "Workspace created",
        description: `Materials workspace ready at ${result.workspacePath}`,
        type: "success",
        data: {
          dismissAfterVisibleMs: 3000,
        },
      });

      // 2. Register workspace as a project and start a new session/thread
      // NOTE: The workspace registration and project creation is handled by the backend
      // when ensureStudentWorkspace is called. The worktreePath option tells the thread
      // to root itself at the student's materials folder.
      await handleNewThread(defaultProjectRef, {
        worktreePath: result.workspacePath,
      });

      toastManager.add({
        title: "Session started",
        description: `Ready to generate materials for ${student.name}`,
        type: "success",
        data: {
          dismissAfterVisibleMs: 3000,
        },
      });
    } catch (error) {
      console.error("Failed to generate materials:", error);
      toastManager.add({
        title: "Failed to generate materials",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        type: "error",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-4 p-6", className)}>
      {/* Student Info */}
      <div className="space-y-3">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">{student.name}</h2>
        </div>

        {student.school && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              School
            </span>
            <span className="text-sm text-foreground">{student.school}</span>
          </div>
        )}

        {student.subjects && student.subjects.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Subjects
            </span>
            <div className="flex flex-wrap gap-2">
              {student.subjects.map((subject, index) => (
                <span
                  key={index}
                  className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
                >
                  {subject}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 pt-2">
        <Button
          onClick={handleGenerateMaterials}
          disabled={isGenerating}
          variant="default"
          className="w-full sm:w-auto"
        >
          <FolderIcon className="size-4" />
          {isGenerating ? "Creating workspace..." : "Generate materials"}
        </Button>
      </div>
    </div>
  );
}
