const express = require("express");
const app = express();
const cors = require("cors");
const PORT = process.env.PORT || 5000;
const Oauth = require("./utils/Oauth");
const axios = require("axios");
const Twit = require("twit");
const util = require("util");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON
);

dotenv.config();
//Configuring Express
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
const callbackURL = "http://127.0.0.1:5000/";
const TwitterApi = require("twitter-api-v2").default;
const twitterClient = new TwitterApi({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
});

//test route
// app.get("/test", (req, res) => {
//   res.send("Aye mate");
// });

// github routes
app.post("/auth", (req, res) => {
  const code = req.query.code;
  Oauth(code)
    .then((token) => {
      // console.log({ token });
      const getUserInfo = async () => {
        const repos = await axios.get("https://api.github.com/user/repos", {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
        const user = await axios.get("https://api.github.com/user", {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
        const payload = { repos: repos.data, user: user.data, token };
        // console.log(payload);
        res.json(payload);
      };

      getUserInfo();
    })
    .catch((err) => {
      res.json({ err });
    });
});
app.post("/loggedin", (req, res) => {
  const token = req.query.token;
  const getUserInfo = async () => {
    const repos = await axios.get("https://api.github.com/user/repos", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    const user = await axios.get("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    const payload = { repos: repos.data, user: user.data };
    // console.log(payload);
    res.json(payload);
  };

  getUserInfo();
});
app.post("/webhook", (req, res) => {
  const link = req.query.link;
  const token = req.query.token;
  const data = {
    name: "web",
    active: true,
    events: ["push"],
    config: {
      url: "https://8b65-197-210-85-40.eu.ngrok.io/tweet",
      content_type: "json",
      insecure_ssl: "0",
    },
  };
  const headers = {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
  };
  const setHook = async () => {
    const response = await axios.post(link, data, headers);
    // console.log(response);
    res.json(response.data);
  };
  setHook();
});

// github-to-twitter routes
app.post("/tweet", async (req, res) => {
  const tweet = req.body.commits[0].message;
  const link = req.body.commits[0].url;
  // require("child_process").spawn("clip").stdin.end(util.inspect(req.body));
  const author = req.body.sender.login;
  // find the refresh tokens for user and generate new token
  const { data, error } = await supabase
    .from("tokens")
    .select("access, refresh")
    .order("id", { ascending: false })
    .eq("login", author)
    .limit(1);
  let refresh = data[0].refresh;
  const { client, accessToken, refreshToken } =
    await twitterClient.refreshOAuth2Token(refresh);
  const { err } = await supabase
    .from("tokens")
    .update({ access: accessToken, refresh: refreshToken })
    .eq("login", author);
  // console.log(data);
  if (tweet.includes("tweet:")) {
    const updatedTweet = tweet.replace("tweet:", "");
    const { data: tweetData } = await client.v2.tweet(
      `#automatedbystreakbot \n ${updatedTweet} \n ${link}`
    );
    console.log(tweetData);
  }
});

// streakbot v2 routes
app.get("/tweet/v2", async (req, res) => {
  const { url, codeVerifier, state } = twitterClient.generateOAuth2AuthLink(
    callbackURL,
    { scope: ["tweet.read", "tweet.write", "users.read", "offline.access"] }
  );
  res.redirect(url);
  // console.log({ codeVerifier, state });
  const { error } = await supabase
    .from("codes")
    .insert({ code_verifier: codeVerifier, state });
  if (error) {
    console.log(error);
  }
});

app.get("/", async (req, res) => {
  const { code, state } = req.query;
  // fetch code verifier from db
  const { data, error } = await supabase
    .from("codes")
    .select()
    .eq("state", state);
  // obtain  access tokens
  if (!error) {
    const codeVerifier = data[0].code_verifier;
    const { client, accessToken, refreshToken } =
      await twitterClient.loginWithOAuth2({
        code,
        codeVerifier,
        redirectUri: callbackURL,
      });
    // save access tokens
    const { error } = await supabase
      .from("tokens")
      .insert({ access: accessToken, refresh: refreshToken });
    if (error) {
      console.log(error);
    } else {
      res.redirect(
        `http://127.0.0.1:5173/authorized/streak?access=${accessToken}`
      );
    }
  } else {
    console.log("User state doesn't exist");
    res.send({ saved_state_error: error });
  }
});

app.post("/update", async (req, res) => {
  const { token, login } = req.query;
  // update row with login data
  let update = {
    login: login,
  };
  const { error } = await supabase.from("tokens").delete().eq("login", login);
  if (error || !error) {
    const { data, error } = await supabase
      .from("tokens")
      .select()
      .eq("access", token);
    if (!data[0].login) {
      const { data, error } = await supabase
        .from("tokens")
        .update(update)
        .eq("access", token);
      if (!error) {
        console.log("Update successful");
      } else {
        console.log(error);
      }
    }
  }
});
//Listen
app.listen(PORT, () => {
  console.log("Server is running...");
});
