import axios from "axios";
import { z } from "zod";
import { tool } from "@langchain/core/tools";

export const weatherInfo = tool(
  async (input) => {
    const url = `https://wttr.in/${input.city.toLowerCase()}?format=%C+%t`;
    const { data } = await axios.get(url, { timeout: 10000 });
    return `The current weather of ${input.city} is ${data}`;
  },
  {
    name: "weatherInfo",
    description:
      "Gets the current weather for a given city. Use this when the user asks about weather conditions (temperature, conditions like rain/clouds/sunny) for a specific city.",
    schema: z.object({
      city: z.string().describe("The name of the city, e.g. Delhi, Tokyo, New York"),
    }),
  },
);

// Legacy export for backwards compatibility with old_version tooling
export const weatherInfoLegacy = weatherInfo;
