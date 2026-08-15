import { exec } from "child_process";
export const executeCmd = async (cmd = "") => {
  return new Promise((res, rej) => {
    exec(cmd, (err, data) => {
      if (err) {
        return res(`Error running the command : ${cmd} , error : ${err}`);
      } else {
        res(data);
      }
    });
  });
};
