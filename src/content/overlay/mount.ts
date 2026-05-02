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
  style.textContent = [
    `@keyframes rabbitramp-spin { to { transform: rotate(360deg); } }`,
    `@keyframes rabbitramp-hop {`,
    `  0%   { transform: translateY(0)    scaleY(1); }`,
    `  40%  { transform: translateY(-5px) scaleY(1.05); }`,
    `  100% { transform: translateY(-9px) scaleY(0.95); }`,
    `}`,
  ].join(" ");
  document.head.appendChild(style);

  const container = document.createElement("div");
  container.id = "rabbitramp-statusbar-root";
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
