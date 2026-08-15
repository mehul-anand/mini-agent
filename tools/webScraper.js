import * as cheerio from "cheerio";
import axios from "axios";

export const webScraper = async (siteLink="https://example.com") => {
  const url = siteLink;
  const response = await axios.get(url);
  const data = cheerio.load(response.data);
  console.log(data.html());
};
