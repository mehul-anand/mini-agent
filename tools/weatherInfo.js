import axios from "axios";

export const weatherInfo = async (cityname) => {
  const url = `https://wttr.in/${cityname.toLowerCase()}?format=%C+%t`;
  const { data } = await axios.get(url, { resposneType: "text" });
  return `The current weather of ${cityname} is ${data}`;
};
