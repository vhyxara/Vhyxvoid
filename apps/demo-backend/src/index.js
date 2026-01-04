const http = require("http");
const port = process.env.PORT || 5050;
const server = http.createServer((req, res) => {
  if (req.url === "/hello") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "world" }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});
server.listen(port, () => console.log("demo backend listening", port));
