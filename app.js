const express = require('express')
const app = express()
app.use(express.json())
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const path = require('path')

let db = null
const DbPATH = path.join(__dirname, 'twitterClone.db')

const DBandServer = async () => {
  try {
    db = await open({
      filename: DbPATH,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('server running at http://localhost:3000')
    })
  } catch (a) {
    console.log(`DB Error:${a.message}`)
    process.exit(1)
  }
}

DBandServer()

//register user
app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  if (password.length < 6) {
    response.status(400)
    response.send('Password is too short')
    return
  }
  const selectUserQ = `SELECT * FROM user WHERE username= '${username}';`
  const dbuser = await db.get(selectUserQ)
  if (dbuser === undefined) {
    const hashedpassword = await bcrypt.hash(password, 10)
    const createUserQ = `INSERT INTO user(username,password,name,gender) 
    VALUES('${username}','${hashedpassword}','${name}','${gender}');`
    await db.run(createUserQ)
    response.send('User created successfully')
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

//login
app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const selectUserQ = `SELECT * FROM user WHERE username= '${username}';`
  const dbuser = await db.get(selectUserQ)
  if (dbuser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const ispasswordMatch = await bcrypt.compare(password, dbuser.password)
    if (ispasswordMatch === true) {
      const payload = {user_id: dbuser.user_id}
      const jwtToken = jwt.sign(payload, 'MY_TOKEN')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

//middleware function
const authToken = (request, response, next) => {
  const authHeader = request.headers['authorization']
  let jwtToken
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (authHeader === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'MY_TOKEN', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.userId = payload.user_id
        next()
      }
    })
  }
}

// API 3
app.get('/user/tweets/feed/', authToken, async (request, response) => {
  const {userId} = request

  const getFeedQuery = `
      SELECT
        u.username,
        t.tweet,
        t.date_time AS dateTime
      FROM user u
      LEFT JOIN tweet t
        ON u.user_id = t.user_id
      LEFT JOIN follower f
        ON u.user_id = f.following_user_id
      WHERE
        f.follower_user_id = '${userId}'
      ORDER BY
        t.date_time DESC
      LIMIT 4;
    `

  const feed = await db.all(getFeedQuery)
  response.send(feed)
})

// API 4
app.get('/user/following/', authToken, async (request, response) => {
  const {userId} = request

  const getFollowingQuery = `
    SELECT
      u.name
    FROM follower f
    LEFT JOIN user u
      ON f.following_user_id = u.user_id
    WHERE
      f.follower_user_id = '${userId}';
  `

  const followingList = await db.all(getFollowingQuery)
  response.send(followingList)
})

//API 5
app.get('/user/followers/', authToken, async (request, response) => {
  const {userId} = request

  const getFollowingQuery = `
    SELECT
      u.name
    FROM follower f
    LEFT JOIN user u
      ON f.follower_user_id = u.user_id
    WHERE
      f.following_user_id ='${userId}';
  `

  const followingList = await db.all(getFollowingQuery)
  response.send(followingList)
})

//API 6
app.get('/tweets/:tweetId/', authToken, async (request, response) => {
  const {userId} = request
  const {tweetId} = request.params

  //Check whether tweet belongs to a followed user
  const checkQuery = `
    SELECT
      tweet.tweet,
      tweet.date_time AS dateTime
    FROM tweet
    LEFT JOIN follower
      ON tweet.user_id = follower.following_user_id
    WHERE
      tweet.tweet_id = ?
      AND follower.follower_user_id = ?;
  `

  const tweetDetails = await db.get(checkQuery, [tweetId, userId])

  //Tweet not from followed user
  if (tweetDetails === undefined) {
    response.status(401)
    response.send('Invalid Request')
    return
  }

  //Get likes count
  const likesQuery = `
    SELECT COUNT(*) AS likes
    FROM like
    WHERE tweet_id = ?;
  `
  const likesResult = await db.get(likesQuery, [tweetId])

  //Get replies count
  const repliesQuery = `
    SELECT COUNT(*) AS replies
    FROM reply
    WHERE tweet_id = ?;
  `
  const repliesResult = await db.get(repliesQuery, [tweetId])

  // Valid tweet
  response.send({
    tweet: tweetDetails.tweet,
    likes: likesResult.likes,
    replies: repliesResult.replies,
    dateTime: tweetDetails.dateTime,
  })
})

//API 7
app.get('/tweets/:tweetId/likes/', authToken, async (request, response) => {
  const {userId} = request
  const {tweetId} = request.params

  // Validate whether tweet belongs to followed user
  const checkQuery = `
    SELECT tweet.tweet_id
    FROM tweet
    LEFT JOIN follower
      ON tweet.user_id = follower.following_user_id
    WHERE
      tweet.tweet_id = '${tweetId}'
      AND follower.follower_user_id = '${userId}';
  `

  const validTweet = await db.get(checkQuery)

  // Invalid tweet access
  if (validTweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
    return
  }

  // Get usernames who liked the tweet
  const likesQuery = `
    SELECT user.username
    FROM like
    LEFT JOIN user
      ON like.user_id = user.user_id
    WHERE
      like.tweet_id = '${tweetId}';
  `

  const likesList = await db.all(likesQuery)

  const usernames = likesList.map(each => each.username)

  response.send({likes: usernames})
})

//API 8
app.get('/tweets/:tweetId/replies/', authToken, async (request, response) => {
  const {userId} = request
  const {tweetId} = request.params

  //Check if tweet belongs to a followed user
  const checkQuery = `
    SELECT tweet.tweet_id
    FROM tweet
    LEFT JOIN follower
      ON tweet.user_id = follower.following_user_id
    WHERE
      tweet.tweet_id = ${tweetId}
      AND follower.follower_user_id = ${userId};
  `

  const validTweet = await db.get(checkQuery)

  //Invalid Request
  if (validTweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
    return
  }

  //Get replies
  const repliesQuery = `
    SELECT
      user.name,
      reply.reply
    FROM reply
    LEFT JOIN user
      ON reply.user_id = user.user_id
    WHERE
      reply.tweet_id = ${tweetId};
  `

  const repliesList = await db.all(repliesQuery)

  response.send({
    replies: repliesList,
  })
})

//API 9
app.get('/user/tweets/', authToken, async (request, response) => {
  const {userId} = request

  const getUserTweetsQuery = `
    SELECT
      tweet.tweet,
      tweet.date_time AS dateTime,
      (
        SELECT COUNT(*)
        FROM like
        WHERE like.tweet_id = tweet.tweet_id
      ) AS likes,
      (
        SELECT COUNT(*)
        FROM reply
        WHERE reply.tweet_id = tweet.tweet_id
      ) AS replies
    FROM tweet
    WHERE tweet.user_id = ${userId};
  `

  const userTweets = await db.all(getUserTweetsQuery)
  response.send(userTweets)
})

//API 10
app.post('/user/tweets/', authToken, async (request, response) => {
  const {userId} = request
  const {tweet} = request.body

  const createTweetQuery = `
    INSERT INTO tweet (tweet, user_id, date_time)
    VALUES (
      '${tweet}',
      ${userId},
      datetime('now')
    );
  `

  await db.run(createTweetQuery)
  response.send('Created a Tweet')
})

//API 11
app.delete('/tweets/:tweetId/', authToken, async (request, response) => {
  const {userId} = request
  const {tweetId} = request.params

  // Check if tweet belongs to logged-in user
  const checkQuery = `
    SELECT tweet_id
    FROM tweet
    WHERE
      tweet_id = ${tweetId}
      AND user_id = ${userId};
  `

  const tweet = await db.get(checkQuery)

  // Trying to delete someone else's tweet
  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
    return
  }

  //Delete tweet
  const deleteQuery = `
    DELETE FROM tweet
    WHERE tweet_id = ${tweetId};
  `

  await db.run(deleteQuery)

  response.send('Tweet Removed')
})

module.exports = app
