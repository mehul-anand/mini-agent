import dotenv from "dotenv";
import { OpenAI } from "openai";
import { SYSTEM_PROMPT_AGENT } from "./prompts/agentPrompt.js";
import chalk from "chalk";
import blessed from "blessed";
import figlet from "figlet";
import { TOOL_MAP } from "./tools/toolMap.js";

// dotenv : for the environment variables
dotenv.config({ path: "../../.env" });

// sleep function
const sleep = (ms = 2000) => new Promise((r) => setTimeout(r, ms));

// OpenAI client
const client = new OpenAI();

// Global blessed components
let screen, contentBox, inputBox;

function initializeScreen() {
  // Create the main screen
  screen = blessed.screen({
    smartCSR: true,
    title: "AI Studio",
    dockBorders: true,
  });

  // Main content area
  contentBox = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: "100%-3",
    border: {
      type: "double",
    },
    style: {
      fg: "white",
      bg: "black",
      border: {
        fg: "cyan",
      },
    },
    // label: " AI Studio ",
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: true,
  });

  // Input area
  inputBox = blessed.textbox({
    bottom: 0,
    left: 0,
    width: "100%",
    height: 3,
    border: {
      type: "line",
    },
    style: {
      fg: "cyan",
      bg: "black",
      border: {
        fg: "cyan",
      },
    },
    label: " Enter your question and press Enter ",
    inputOnFocus: true,
  });


  // Append to screen
  screen.append(contentBox);
  screen.append(inputBox);

  // Handle exit keys
  screen.key(["escape", "q", "C-c"], () => {
    process.exit(0);
  });

  // Render the screen
  screen.render();
}

function addToContent(text) {
  const currentContent = contentBox.getContent();
  const newContent = currentContent + (currentContent ? "\n" : "") + text;
  contentBox.setContent(newContent);

  // Auto-scroll to bottom
  contentBox.setScrollPerc(100);
  screen.render();
}

async function showWelcome() {
  const welcomeText = figlet.textSync(`Welcome to\n \nAI Studio `, {
    font: "Standard",
    horizontalLayout: "full",
    verticalLayout: "fitted",
  });

  addToContent(chalk.hex("#876DF5").bold(welcomeText));
  addToContent(
    chalk.bold(
      `Enter your query and our state of the art model will help you out`
    )
  );
  await sleep();
}

function getUserInput() {
  return new Promise((resolve) => {
    // Add input prompt to content
    addToContent(chalk.cyan.bold("INPUT:"));
    addToContent("Enter a question:");
    addToContent(chalk.gray("─".repeat(50)));

    // Clear input box and focus
    inputBox.clearValue();
    inputBox.focus();

    // Handle input submission
    const handleInput = () => {
      const userInput = inputBox.getValue().trim();

      if (userInput) {
        // Add user input to content
        addToContent(chalk.cyan(`> ${userInput}`));
        addToContent(""); // spacing

        // Remove the event listener to prevent multiple triggers
        inputBox.removeListener("submit", handleInput);

        resolve(userInput);
      } else {
        inputBox.setLabel(" Please enter a question! ");
        screen.render();
        setTimeout(() => {
          inputBox.setLabel(" Enter your question and press Enter ");
          screen.render();
        }, 2000);
      }
    };

    inputBox.on("submit", handleInput);
  });
}

async function processQuery(userText) {
  // Add processing indicator
  addToContent(chalk.cyan("🔄 Processing your request..."));
  addToContent("");

  const messagesArr = [
    {
      role: "system",
      content: SYSTEM_PROMPT_AGENT,
    },
    {
      role: "user",
      content: userText,
    },
  ];

  while (true) {
    try {
      const response = await client.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: messagesArr,
      });

      const rawContent = response.choices[0].message.content;
      const parsedContent = JSON.parse(rawContent);

      messagesArr.push({
        role: "assistant",
        content: JSON.stringify(parsedContent),
      });

      if (parsedContent.step === "START") {
        addToContent(`${chalk.cyan.bold("INITIATED")}: ${parsedContent.content}`);
        addToContent("");
        continue;
      } else if (parsedContent.step === "THINK") {
        addToContent(`${chalk.cyan.bold("THINKING")}: ${parsedContent.content}`);
        addToContent("");
        await sleep(1000);
        continue;
      } else if (parsedContent.step === "TOOL") {
        const toolCalled = parsedContent.tool_name;
        if (!TOOL_MAP[toolCalled]) {
          messagesArr.push({
            role: "developer",
            content: `There is no such tool as ${toolCalled}`,
          });
        } else {
          const toolResponse = await TOOL_MAP[toolCalled](parsedContent.input);
          addToContent(
            `${chalk.cyan.bold("PROCESS:")}${toolCalled}(${
              parsedContent.input
            }) = ${toolResponse}`
          );
          messagesArr.push({
            role: "developer",
            content: JSON.stringify({ step: "OBSERVE", content: toolResponse }),
          });
          addToContent("");
          await sleep(1000);
          continue;
        }
      } else if (parsedContent.step === "OUTPUT") {
        addToContent(`${chalk.cyan.bold("OUTPUT:")}:${parsedContent.content}`);
        addToContent("");
        inputBox.clearValue();
        break;
      }
    } catch (error) {
      addToContent(chalk.red(`Error: ${error.message}`));
      break;
    }
  }

  addToContent(chalk.magenta.bold("✨ COMPLETED SUCCESSFULLY!"));
  addToContent(chalk.gray("Ask another question or press Escape to exit"));
  addToContent("");
}

async function main() {
  // Initialize the blessed interface
  initializeScreen();

  // Show welcome message
  await showWelcome();

  // Main conversation loop
  while (true) {
    try {
      const userText = await getUserInput();

      if (!userText.trim()) {
        addToContent(chalk.red("Empty Prompt, please try again"));
        addToContent("");
        continue;
      }

      await processQuery(userText);
    } catch (error) {
      addToContent(chalk.red(`Unexpected error: ${error.message}`));
      addToContent("");
    }
  }
}

main();
