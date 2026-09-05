const { app, BrowserWindow } = require("electron");
const path = require("node:path");

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: { sandbox: true } });
  await window.loadFile(path.join(__dirname, "engine-smoke.html"));
  const deadline = Date.now() + 12_000;
  let result;
  while (Date.now() < deadline) {
    result = await window.webContents.executeJavaScript("window.emberlySmoke");
    if (result) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!result?.ok) {
    console.error(result?.message || "Original Emberly renderer did not finish loading");
    app.exit(1);
    return;
  }
  console.log(result.message);
  app.exit(0);
});

