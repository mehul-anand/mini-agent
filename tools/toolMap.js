import { executeCmd } from "./executeCmd.js";
import { weatherInfo } from "./weatherInfo.js";
import { webScraper } from "./webScraper.js";
export const TOOL_MAP = {
  weatherInfo: weatherInfo,
  executeCmd: executeCmd,
  webScraper: webScraper,
};
