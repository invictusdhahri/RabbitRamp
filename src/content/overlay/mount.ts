import { createRoot, Root } from "react-dom/client";
import { createElement } from "react";
import { StatusBar, StatusBarState } from "./StatusBar";
import { CourseContext } from "../../shared/types";

let root: Root | null = null;
let currentState: StatusBarState = {
  context: {
    courseName: "",
    weekLabel: "",
    itemTitle: "",
    itemType: "unknown",
    url: "",
  },
  status: "idle",
  message: "Ready",
};

export function mountStatusBar(): void {
  if (root) return;

  // Inject spinner keyframes
  const style = document.createElement("style");
  style.textContent = `@keyframes courscheat-spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);

  const container = document.createElement("div");
  container.id = "courscheat-statusbar-root";
  document.body.appendChild(container);

  root = createRoot(container);
  render();
}

export function updateStatusBar(state: Partial<StatusBarState> & { context: CourseContext }): void {
  currentState = { ...currentState, ...state };
  render();
}

function render(): void {
  if (!root) return;
  root.render(
    createElement(StatusBar, {
      context: currentState.context,
      status: currentState.status,
      message: currentState.message,
    })
  );
}
