const functions = require('firebase-functions');
const express = require('express');
const fbAuth = require('./utils/fbAuth');
const cors = require('cors');
const { db } = require('./utils/admin');
const algoliasearch = require('algoliasearch');

require('dotenv').config();

const app = express();
app.use(cors({ origin: true }));

const {
  getAllPosts,
  postOnePost,
  getPost,
  deletePost,
  commentOnPost,
  deleteComment,
  favPost,
  unfavPost,
  togglePostUpvote,
  togglePostDownvote,
} = require('./handlers/posts');
const {
  signup,
  login,
  uploadImage,
  addUserDetails,
  getAuthedUser,
  getAllUsers,
  getUserDetails,
  markNotificationsRead,
} = require('./handlers/users');

// Post routes
app.get('/posts', getAllPosts);
app.post('/post', fbAuth, postOnePost);
app.get('/post/:postId', getPost);
app.delete('/post/:postId', fbAuth, deletePost);
app.post('/post/:postId/comment', fbAuth, commentOnPost);
app.delete('/post/:postId/comment/:commentId', fbAuth, deleteComment);
app.post('/post/:postId/fav', fbAuth, favPost);
app.post('/post/:postId/unfav', fbAuth, unfavPost);
app.post('/post/:postId/togglePostUpvote', fbAuth, togglePostUpvote);
app.post('/post/:postId/togglePostDownvote', fbAuth, togglePostDownvote);

// Users routes
app.post('/signup', signup);
app.post('/login', login);
app.post('/user/image', fbAuth, uploadImage);
app.get('/users', getAllUsers);
app.get('/user', fbAuth, getAuthedUser);
app.post('/user', fbAuth, addUserDetails);
app.get('/user/:userName', getUserDetails);
app.post('/notifications', fbAuth, markNotificationsRead);

exports.api = functions.region('europe-west1').https.onRequest(app);

exports.createNotificationOnFav = functions
  .region('europe-west1')
  .firestore.document('favs/{id}')
  .onCreate((snapshot) => {
    return db
      .doc(`/posts/${snapshot.data().postId}`)
      .get()
      .then((doc) => {
        if (doc.exists && doc.data().author !== snapshot.data().userName) {
          return db.doc(`/notifications/${snapshot.id}`).set({
            createdAt: new Date().toISOString(),
            recipient: doc.data().author,
            sender: snapshot.data().userName,
            type: 'fav',
            read: false,
            postId: doc.id,
          });
        }
      })
      .catch((err) => console.error(err));
  });

exports.deleteNotificationOnUnfav = functions
  .region('europe-west1')
  .firestore.document('favs/{id}')
  .onDelete((snapshot) => {
    return db
      .doc(`/notifications/${snapshot.id}`)
      .delete()
      .catch((err) => {
        console.error(err);
        return;
      });
  });

exports.createNotificationOnComment = functions
  .region('europe-west1')
  .firestore.document('comments/{id}')
  .onCreate((snapshot) => {
    console.log(snapshot.data());
    return db
      .doc(`/posts/${snapshot.data().postId}`)
      .get()
      .then((doc) => {
        console.log(doc.data());
        if (doc.exists && doc.data().author !== snapshot.data().userName) {
          return db.doc(`/notifications/${snapshot.id}`).set({
            createdAt: new Date().toISOString(),
            recipient: doc.data().author,
            sender: snapshot.data().userName,
            type: 'comment',
            read: false,
            postId: doc.id,
          });
        }
      })
      .catch((err) => {
        console.error(err);
        return;
      });
  });

exports.deleteNotificationOnUncomment = functions
  .region('europe-west1')
  .firestore.document('comments/{id}')
  .onDelete((snapshot) => {
    return db
      .doc(`/notifications/${snapshot.id}`)
      .delete()
      .catch((err) => {
        console.error(err);
        return;
      });
  });

exports.onUserImageChange = functions
  .region('europe-west1')
  .firestore.document('/users/{userId}')
  .onUpdate((change) => {
    console.log(change.before.data());
    console.log(change.after.data());
    if (change.before.data().imageUrl !== change.after.data().imageUrl) {
      console.log('Image has been updated');

      const batch = db.batch();
      return db
        .collection('posts')
        .where('author', '==', change.before.data().userName)
        .get()
        .then((data) => {
          console.log(data);
          data.forEach((doc) => {
            const post = db.doc(`/posts/${doc.id}`);
            batch.update(post, { userImage: change.after.data().imageUrl });
          });
          return batch.commit();
        });
    } else return true;
  });

exports.onPostCreate = functions
  .region('europe-west1')
  .firestore.document('/posts/{postId}')
  .onCreate((snapshot, context) => {
    const postId = context.params.postId;

    const postDocument = db.doc(`posts/${postId}`);

    let newPost = {};

    return postDocument
      .get()
      .then((doc) => {
        if (doc.exists) {
          newPost = doc.data();
          newPost.objectID = doc.id;

          // Save post on Algolia
          const client = algoliasearch(
            process.env.ALGOLIA_APP_ID,
            process.env.ALGOLIA_ADMIN_KEY
          );
          const index = client.initIndex(process.env.ALGOLIA_INDEX_NAME);
          index.saveObject(newPost);
        } else {
          return true;
        }
      })
      .catch((err) => {
        console.log(err);
      });
  });

exports.onPostDelete = functions
  .region('europe-west1')
  .firestore.document('/posts/{postId}')
  .onDelete((snapshot, context) => {
    const postId = context.params.postId;
    const batch = db.batch();

    // Delete post from Algolia
    const client = algoliasearch(
      process.env.ALGOLIA_APP_ID,
      process.env.ALGOLIA_ADMIN_KEY
    );
    const index = client.initIndex(process.env.ALGOLIA_INDEX_NAME);
    index.deleteObject(postId);

    return db
      .collection('comments')
      .where('postId', '==', postId)
      .get()
      .then((data) => {
        data.forEach((doc) => {
          batch.delete(db.doc(`/comments/${doc.id}`));
        });
        return db.collection('favs').where('postId', '==', postId).get();
      })
      .then((data) => {
        data.forEach((doc) => {
          batch.delete(db.doc(`/favs/${doc.id}`));
        });
        return db
          .collection('notifications')
          .where('postId', '==', postId)
          .get();
      })
      .then((data) => {
        data.forEach((doc) => {
          batch.delete(db.doc(`/notifications/${doc.id}`));
        });
        return batch.commit();
      })
      .catch((err) => console.error(err));
  });

const _ = {
  async fullPosts() {
    const postsCollection = await db
      .collection('posts')
      .orderBy('createdAt', 'desc')
      .get();

    // Promise.all() will take a list of promises and will return their results once they have all finished.
    return await Promise.all(
      // Array.prototype.map() will take an existing array and, for each item, call the given function and return a new array with the return value of each function in that array.
      // This is functionally equivalent to making a new array and push()ing to it, but it reads a lot nicer!
      postsCollection.docs.map(async (doc) => {
        const post = doc.data();
        post.id = doc.id;
        post.comments = [];
        post.favs = [];
        post.upvotes = [];
        post.downvotes = [];

        const commentsCollection = await db
          .collection('comments')
          .orderBy('createdAt', 'asc')
          .where('postId', '==', post.id)
          .get();

        commentsCollection.forEach((doc) => {
          const comment = doc.data();
          comment.id = doc.id;
          post.comments.push(comment);
        });

        const favsCollection = await db
          .collection('favs')
          .where('postId', '==', post.id)
          .get();

        favsCollection.forEach((doc) => {
          const fav = doc.data();
          fav.id = doc.id;
          post.favs.push(fav);
        });

        const upvotesPostCollection = await db
          .collection('postUpvotes')
          .where('postId', '==', post.id)
          .get();

        upvotesPostCollection.forEach((doc) => {
          const upvote = doc.data();
          upvote.id = doc.id;
          post.upvotes.push(upvote);
        });

        const downvotesPostCollection = await db
          .collection('postDownvotes')
          .where('postId', '==', post.id)
          .get();

        downvotesPostCollection.forEach((doc) => {
          const upvote = doc.data();
          upvote.id = doc.id;
          post.upvotes.push(upvote);
        });

        return post;
      })
    );
  },
};

exports.addFirestoreDataToAlgoria = functions.https.onRequest((req, res) => {
  return db
    .collection('posts')
    .get()
    .then((docs) => {
      postsArray = [];

      docs.forEach((doc) => {
        const post = doc.data();
        post.objectID = doc.id;

        postsArray.push(post);
      });

      const client = algoliasearch(
        process.env.ALGOLIA_APP_ID,
        process.env.ALGOLIA_ADMIN_KEY
      );

      const index = client.initIndex(process.env.ALGOLIA_INDEX_NAME);

      index.saveObjects(postsArray);

      res.status(200).json({ message: 'Posts saved on Algolia successfully' });
    })
    .catch((err) => {
      console.error(err);
      res.status(500).json({ error: 'Something went wrong' });
    });
});
