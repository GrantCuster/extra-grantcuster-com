const express = require("express");
const AWS = require("aws-sdk");
const AtpAgent = require("@atproto/api").AtpAgent;
const RichText = require("@atproto/api").RichText;
const cors = require("cors");
require("dotenv").config();

const agent = new AtpAgent({
  service: "https://bsky.social",
});

console.log("process.env.NODE_ENV", process.env.NODE_ENV);

const corsOptions = {
  origin: function(origin, callback) {
    if (
      process.env.NODE_ENV !== "production" ||
      origin === "https://garden.grantcuster.com"
    ) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
};

const app = express();
app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb" }));

// Set up AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

app.get("/test", (req, res) => {
  res.send("Hello World!");
})

app.post("/api/postToBluesky", async (req, res) => {
  const status = req.body.status;
  const url = req.body.url;
  const image = req.body.image;
  const title = req.body.title;
  const description = req.body.description;

  if (req.headers.authorization !== "Bearer " + process.env.ADMIN_PASSWORD) {
    return res.status(403).send("Forbidden");
  }

  try {
    const rt = new RichText({
      text: status,
    });
    await rt.detectFacets(agent);

    const _post = {
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString(),
      embed: {
        $type: "app.bsky.embed.external",
        external: {
          uri: url,
          title: title,
          description: description,
          thumb: image,
        },
      },
    };

    await agent.login({
      identifier: process.env.BLUESKY_IDENTIFIER,
      password: process.env.BLUESKY_PASSWORD,
    });
    const data = await uploadS3FileToAgent(
      agent,
      _post.embed.external.thumb.replace(
        "https://grant-uploader.s3.amazonaws.com/",
        "",
      ),
    );

    _post.embed.external.thumb = data.blob;

    await agent.post(_post);

    res.json({ success: "posted" });
  } catch (error) {
    console.log(error);
    res.status(500).send("Error uploading file to agent.");
  }
});

async function uploadS3FileToAgent(agent, s3Key) {
  try {
    // Download file from S3
    const s3Object = await s3
      .getObject({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: s3Key,
      })
      .promise();

    // `s3Object.Body` is already a Buffer, so you can use it directly
    const fileBuffer = s3Object.Body;

    // Upload the buffer to your agent (assuming the agent accepts Buffer for blob data)
    const { data } = await agent.uploadBlob(fileBuffer, {
      encoding: "image/jpeg",
    });

    return data; // Response from agent upload
  } catch (error) {
    console.log(error);
    console.error("Error uploading file:", error);
    throw error;
  }
}

const port = 3030;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
