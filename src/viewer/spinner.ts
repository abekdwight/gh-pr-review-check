import chalk from "chalk";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL = 80;

export interface Spinner {
  /** Update the spinner message (does not print a new line). */
  update: (msg: string) => void;
  /** Stop the spinner and clear the line. */
  stop: () => void;
}

export function createSpinner(): Spinner {
  let frameIndex = 0;
  let currentMsg = "";
  let timer: ReturnType<typeof setInterval> | null = null;

  const render = () => {
    const frame = chalk.cyan(FRAMES[frameIndex % FRAMES.length]);
    process.stderr.write(`\r\x1b[K  ${frame} ${chalk.dim(currentMsg)}`);
    frameIndex++;
  };

  const update = (msg: string) => {
    currentMsg = msg;
    if (!timer) {
      timer = setInterval(render, INTERVAL);
      render();
    }
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    // Clear the spinner line
    process.stderr.write("\r\x1b[K");
  };

  return { update, stop };
}
