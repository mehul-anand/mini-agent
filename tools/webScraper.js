import { z } from "zod";
import { tool } from "@langchain/core/tools";
import axios from "axios";
import * as cheerio from "cheerio";

export const webScraper = tool(
  async (input) => {
    const url = input.url;
    try {
      const response = await axios.get(url, { timeout: 15000 });
      const $ = cheerio.load(response.data);

      $("script, style, noscript").remove();
      const text = $.text().replace(/\s+/g, " ").trim();

      const title = $("title").text().trim() || url;

      const preview = text.slice(0, 2000);

      return `Title: ${title}\nURL: ${url}\nContent preview:\n${preview}\n${text.length > 2000 ? `... (${text.length - 2000} more chars)` : ""}`;
    } catch (err) {
      return `Error scraping ${url}: ${err.message}`;
    }
  },
  {
    name: "webScraper",
    description:
      "Fetches a web page and extracts its text content (strips HTML tags, scripts, styles). Returns the page title and a text preview. Use this to research documentation, read blog posts, or scrape web content.",
    schema: z.object({
      url: z.string().describe("The full URL to scrape (e.g. https://example.com)."),
    }),
  },
);
