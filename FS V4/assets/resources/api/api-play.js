import { exec } from "child_process";

export default function (api) {
  api.post("/play-vlc", (req, res) => {
    const { url, subtitle } = req.body;

    if (!url) return res.status(400).send("No video URL");

    let command = `"C:\\Program Files\\VideoLAN\\VLC\\vlc.exe" "${url}"`;

    if (subtitle) {
      command += ` --sub-file="${subtitle}"`;
    }

    exec(command, (err) => {
      if (err) {
        console.error("VLC error:", err);
        return res.status(500).send("Failed to launch VLC");
      }
      res.status(200).send("Launched VLC");
    });
  });
}
