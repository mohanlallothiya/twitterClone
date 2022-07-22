const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const app = express();
app.use(express.json());

let db = null;
const dbPath = path.join(__dirname, "twitterClone.db");
const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error:${e.message}`);
    process.exit(1);
  }
};
initializeDBAndServer();

function authenticateToken(request, response, next) {
  const authHeader = request.headers["authorization"];
  let jwtToken;
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_KEY", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        const dbQuery = ` SELECT * FROM user WHERE username = '${payload.username}'; `;
        const dbUser = await db.get(dbQuery);
        request.userId = dbUser.user_id;
        next();
      }
    });
  }
}
const validateRegister = async (request, response, next) => {
  const { username, password } = request.body;
  const searchUserQuery = `SELECT *
  FROM user
  WHERE username='${username}';`;
  const dbUser = await db.get(searchUserQuery);
  if (dbUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else if (password.length < 6) {
    response.status(400);
    response.send("Password is too short");
  } else {
    next();
  }
};
const validateRequest = async (request, response, next) => {
  const { tweetId } = request.params;
  const { userId } = request;
  const tweet_id = tweetId.replace(":", "");
  const tweetUserIdQuery = `
    SELECT user_id
    FROM tweet
    WHERE tweet_id=${tweet_id};`;
  const followingQuery = `SELECT following_user_id
    FROM follower
    WHERE follower_user_id=${userId};`;
  let tweetUserId = await db.get(tweetUserIdQuery);
  let followingIds = await db.all(followingQuery);
  if (tweetUserId === undefined) {
    response.send("Invalid Request");
  } else {
    const check = followingIds.map((each) => each.following_user_id);
    if (!check.includes(tweetUserId.user_id)) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      next();
    }
  }
};

app.post("/register/", validateRegister, async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const registerUserQuery = `INSERT INTO user
          (name,username,password,gender)
          VALUES
          ('${name}','${username}','${hashedPassword}','${gender}');`;
  await db.run(registerUserQuery);
  response.send("User created successfully");
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const searchUserQuery = `SELECT *
  FROM user
  WHERE username='${username}';`;
  const dbUser = await db.get(searchUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "MY_SECRET_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const feedQuery = `
    SELECT user.username AS username,tweet.tweet AS tweet,tweet.date_time AS dateTime
    FROM tweet LEFT JOIN follower ON tweet.user_id=follower.following_user_id
    LEFT JOIN user user ON tweet.user_id=user.user_id
    WHERE follower_user_id=${userId}
    ORDER BY dateTime DESC
    LIMIT 4;`;
  const feed = await db.all(feedQuery);
  response.send(feed);
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const followingNameQuery = `
    SELECT name
    FROM follower INNER JOIN user ON follower.following_user_id=user.user_id
    WHERE follower_user_id=(SELECT user_id
    FROM user
    WHERE user_id=${userId});`;

  const followerName = await db.all(followingNameQuery);
  response.send(followerName);
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const followingNameQuery = `
    SELECT name
    FROM follower INNER JOIN user ON follower.follower_user_id=user.user_id
    WHERE following_user_id=(SELECT user_id
    FROM user
    WHERE user_id=${userId});`;

  const followerName = await db.all(followingNameQuery);
  response.send(followerName);
});

app.get(
  "/tweets/:tweetId",
  authenticateToken,
  validateRequest,
  async (request, response) => {
    const { tweetId } = request.params;
    const tweet_id = tweetId.replace(":", "");
    const { userId } = request;
    const tweetQuery = `
    SELECT tweet,date_time AS dateTime,tweet_id
    FROM tweet
    where tweet_id=${tweet_id};`;
    const likeQuery = `SELECT COUNT() AS likes
    FROM like
    WHERE tweet_id=${tweet_id};`;

    const replyQuery = `SELECT COUNT() AS replies
    FROM reply
    WHERE tweet_id=${tweet_id};`;

    const tweetTime = await db.get(tweetQuery);
    const likes = await db.get(likeQuery);
    const replies = await db.get(replyQuery);

    response.send({
      tweet_id: tweetTime.tweet_id,
      tweet: tweetTime.tweet,
      likes: likes.likes,
      replies: replies.replies,
      dateTime: tweetTime.dateTime,
    });
  }
);

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  validateRequest,
  async (request, response) => {
    const { userId } = request;
    const { tweetId } = request.params;
    const tweet_id = tweetId.replace(":", "");

    const likesUserQuery = `
    SELECT username
    FROM like LEFT JOIN user ON like.user_id=user.user_id
    WHERE tweet_id=${tweet_id};`;

    const usernames = await db.all(likesUserQuery);
    const usernameList = usernames.map((each) => each.username);
    response.send({ likes: usernameList });
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  validateRequest,
  async (request, response) => {
    const { tweetId } = request.params;
    const tweet_id = tweetId.replace(":", "");

    const replyQuery = `
    SELECT name,reply
    FROM reply LEFT JOIN user ON reply.user_id=user.user_id
    WHERE tweet_id=${tweet_id};`;

    const replies = await db.all(replyQuery);
    response.send({ replies: replies });
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const tweetsQuery = `
  SELECT tweet.tweet, COUNT(DISTINCT(like_id)) AS likes, 
  COUNT(DISTINCT(reply_id)) AS replies, 
  tweet.date_time AS dateTime
  FROM tweet LEFT JOIN like ON tweet.tweet_id = like.tweet_id
  LEFT JOIN reply ON reply.tweet_id = tweet.tweet_id
  WHERE tweet.user_id = ${userId}
  GROUP BY tweet.tweet_id; `;

  const tweets = await db.all(tweetsQuery);
  response.send(tweets);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const { tweet } = request.body;

  const tweetQuery = `
    INSERT INTO tweet
    (tweet,user_id)
    VALUES
    ('${tweet}',${userId});`;

  await db.run(tweetQuery);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { userId } = request;
    const { tweetId } = request.params;
    const tweet_idd = tweetId.replace(":", "");

    const tweetUserIdQuery = `
    SELECT user_id
    FROM tweet
    WHERE tweet_id=${tweet_idd};`;

    const tweetUserId = await db.get(tweetUserIdQuery);
    if (tweetUserId === undefined) {
      response.send("Invalid Request");
    } else {
      if (tweetUserId.user_id === userId) {
        const deleteQuery = `
      DELETE 
      FROM tweet
      WHERE tweet_id=${tweet_idd};`;

        await db.run(deleteQuery);
        response.send("Tweet Removed");
      } else {
        response.status(401);
        response.send("Invalid Request");
      }
    }
  }
);

module.exports = app;
