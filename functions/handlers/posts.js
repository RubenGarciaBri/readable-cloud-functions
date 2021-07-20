const { db } = require('../utils/admin');
const firebase = require('firebase');
const config = require('../utils/config');
const { formatResponsePosts } = require('../utils/helpers');
const axios = require('axios');

// Helper function to get all posts
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

exports.getAllPosts = async (req, res) => {
  _.fullPosts()
    .then((posts) => res.json(formatResponsePosts(posts)))
    .catch((err) => {
      console.error(err);
      res.status(500).json({ error: err.code });
    });
};

// Get one post
exports.getPost = (req, res) => {
  let postData = {};
  db.doc(`/posts/${req.params.postId}`)
    .get()
    .then((doc) => {
      if (!doc.exists) {
        return res.status(404).json({ error: 'Post not found' });
      }
      postData = doc.data();
      postData.postId = doc.id;
      return db
        .collection('comments')
        .orderBy('createdAt', 'asc')
        .where('postId', '==', req.params.postId)
        .get();
    })
    .then((data) => {
      postData.comments = [];
      data.forEach((doc) => {
        postData.comments.push(doc.data());
      });
      return db
        .collection('favs')
        .where('postId', '==', req.params.postId)
        .get();
    })
    .then((data) => {
      postData.favs = [];

      data.forEach((doc) => {
        const fav = doc.data();
        fav.id = doc.id;
        postData.favs.push(fav);
      });

      return db
        .collection('postUpvotes')
        .where('postId', '==', req.params.postId)
        .get();
    })
    .then((data) => {
      postData.upvotes = [];

      data.forEach((doc) => {
        const upvote = doc.data();
        upvote.id = doc.id;
        postData.upvotes.push(upvote);
      });

      return db
        .collection('postDownvotes')
        .where('postId', '==', req.params.postId)
        .get();
    })
    .then((data) => {
      postData.downvotes = [];

      data.forEach((doc) => {
        const downvote = doc.data();
        downvote.id = doc.id;
        postData.downvotes.push(downvote);
      });

      return res.json(postData);
    })
    .catch((err) => {
      console.error(err);
      res.status(500).json({ error: err.code });
    });
};

exports.postOnePost = (req, res) => {
  const newPost = {
    title: req.body.title,
    body: req.body.body,
    category: req.body.category,
    author: req.user.userName,
    userImage: req.user.imageUrl,
    createdAt: new Date().toISOString(),
    commentCount: 0,
    upvotes: [],
    downvotes: [],
    favCount: 0,
    voteScore: 0,
  };

  db.collection('posts')
    .add(newPost)
    .then((doc) => {
      const resPost = newPost;
      resPost.id = doc.id;
      resPost.comments = [];
      resPost.favs = [];

      // Save posts data to Algoria
      axios.get(
        'https://us-central1-readable-bf7a6.cloudfunctions.net/addFirestoreDataToAlgoria'
      );

      res.json(resPost);
    })
    .catch((err) => {
      res.status(500).json({ error: 'Something went wrong' });
      console.error(err);
    });
};

// Delete post
exports.deletePost = (req, res) => {
  const document = db.doc(`/posts/${req.params.postId}`);

  document
    .get()
    .then((doc) => {
      if (!doc.exists) {
        return res.status(404).json({ error: 'Post not found' });
      }
      if (doc.data().author !== req.user.userName) {
        return res.status(403).json({ error: 'Unauthorised' });
      } else {
        return document.delete();
      }
    })
    .then(() => {
      // Save posts data to Algoria
      axios.get(
        'https://us-central1-readable-bf7a6.cloudfunctions.net/addFirestoreDataToAlgoria'
      );

      res.json({ message: 'Post deleted successfully' });
    })
    .catch((err) => {
      console.error(err);
      return res.status(500).json({ error: err.code });
    });
};

// Comment on a post
exports.commentOnPost = (req, res) => {
  if (req.body.body.trim() === '') {
    return res.status(400).json({ error: "Comment can't be empty" });
  }

  const newComment = {
    body: req.body.body,
    createdAt: new Date().toISOString(),
    postId: req.params.postId,
    userName: req.user.userName,
    userImage: req.user.imageUrl,
  };

  db.doc(`/posts/${req.params.postId}`)
    .get()
    .then((doc) => {
      if (!doc.exists) {
        return res.status(404).json({ error: 'Post not found' });
      }
      return doc.ref.update({ commentCount: doc.data().commentCount + 1 });
    })
    .then(() => {
      return db.collection('comments').add(newComment);
    })
    .then((doc) => {
      const resComment = newComment;
      resComment.id = doc.id;

      // Save posts data to Algoria
      axios.get(
        'https://us-central1-readable-bf7a6.cloudfunctions.net/addFirestoreDataToAlgoria'
      );

      res.json(resComment);
    })
    .catch((err) => {
      console.error(err);
      res.status(500).json({ error: 'Something went wrong' });
    });
};

// Delete comment
exports.deleteComment = (req, res) => {
  const comment = db.doc(`/comments/${req.params.commentId}`);
  const post = db.doc(`/posts/${req.params.postId}`);

  comment
    .get()
    .then((doc) => {
      if (!doc.exists) {
        return res.status(404).json({ error: 'Comment not found' });
      }
      if (doc.data().userName !== req.user.userName) {
        return res.status(403).json({ error: 'Unauthorised' });
      } else {
        post.get().then((doc) => {
          if (!doc.exists) {
            return res.status(404).json({ error: 'Post not found' });
          } else {
            return doc.ref.update({
              commentCount: doc.data().commentCount - 1,
            });
          }
        });
      }
    })
    .then(() => {
      return comment.delete();
    })
    .then(() => {
      // Save posts data to Algoria
      axios.get(
        'https://us-central1-readable-bf7a6.cloudfunctions.net/addFirestoreDataToAlgoria'
      );

      res.json({ message: 'Comment deleted successfully' });
    })
    .catch((err) => {
      console.error(err);
      return res.status(500).json({ error: err.code });
    });
};

// Fav a post
exports.favPost = (req, res) => {
  const favDocument = db
    .collection('favs')
    .where('userName', '==', req.user.userName)
    .where('postId', '==', req.params.postId)
    .limit(1);

  const postDocument = db.doc(`posts/${req.params.postId}`);

  let postData = {};

  postDocument
    .get()
    .then((doc) => {
      if (doc.exists) {
        postData = doc.data();
        postData.id = doc.id;
        return favDocument.get();
      } else {
        return res.status(404).json({ error: 'Post not found' });
      }
    })
    .then((data) => {
      if (data.empty) {
        return db
          .collection('favs')
          .add({
            postId: req.params.postId,
            userName: req.user.userName,
          })
          .then(() => {
            postData.favCount++;

            postDocument.update({
              favCount: postData.favCount,
            });

            return db
              .collection('favs')
              .where('postId', '==', postData.id)
              .get();
          })
          .then((data) => {
            postData.favs = [];

            data.forEach((doc) => {
              const fav = doc.data();
              fav.id = doc.id;
              postData.favs.push(fav);
            });

            // Save posts data to Algoria
            axios.get(
              'https://us-central1-readable-bf7a6.cloudfunctions.net/addFirestoreDataToAlgoria'
            );

            return res.json({
              id: postData.id,
              favCount: postData.favCount,
              favs: postData.favs,
            });
          });
      } else {
        return res.status(400).json({ error: 'Post has already been faved' });
      }
    })
    .catch((err) => {
      res.status(500).json({ error: err.code });
    });
};

// Unfav a post
exports.unfavPost = (req, res) => {
  const favDocument = db
    .collection('favs')
    .where('userName', '==', req.user.userName)
    .where('postId', '==', req.params.postId)
    .limit(1);

  const postDocument = db.doc(`posts/${req.params.postId}`);

  let postData = {};

  postDocument
    .get()
    .then((doc) => {
      if (doc.exists) {
        postData = doc.data();
        postData.id = doc.id;
        return favDocument.get();
      } else {
        return res.status(404).json({ error: 'Post not found' });
      }
    })
    .then((data) => {
      if (data.empty) {
        return res.status(400).json({ error: "Post hasn't been faved" });
      } else {
        return db
          .doc(`/favs/${data.docs[0].id}`)
          .delete()
          .then(() => {
            postData.favCount--;
            postDocument.update({ favCount: postData.favCount });

            return db
              .collection('favs')
              .where('postId', '==', postData.id)
              .get();
          })
          .then((data) => {
            postData.favs = [];

            data.forEach((doc) => {
              const fav = doc.data();
              fav.id = doc.id;
              postData.favs.push(fav);
            });

            // Save posts data to Algoria
            axios.get(
              'https://us-central1-readable-bf7a6.cloudfunctions.net/addFirestoreDataToAlgoria'
            );

            return res.json({
              id: postData.id,
              favCount: postData.favCount,
              favs: postData.favs,
            });
          });
      }
    })
    .catch((err) => {
      res.status(500).json({ error: err.code });
    });
};

// Toggle post upvote
exports.togglePostUpvote = (req, res) => {
  const upvoteDocument = db
    .collection('postUpvotes')
    .where('userName', '==', req.user.userName)
    .where('postId', '==', req.params.postId)
    .limit(1);

  const downvoteDocument = db
    .collection('postDownvotes')
    .where('userName', '==', req.user.userName)
    .where('postId', '==', req.params.postId)
    .limit(1);

  const postDocument = db.doc(`posts/${req.params.postId}`);

  let upvotes = [];
  let downvotes = [];
  let postData = {};

  postDocument
    .get()
    .then((doc) => {
      if (doc.exists) {
        postData = doc.data();
        postData.id = doc.id;

        return upvoteDocument.get();
      } else {
        return res.status(404).json({ error: 'Post not found' });
      }
    })
    .then((data) => {
      // Check if the post has been upvoted
      if (data.empty) {
        // If the post hasn't been upvoted, add upvote
        db.collection('postUpvotes').add({
          postId: req.params.postId,
          userName: req.user.userName,
        });
        return downvoteDocument.get().then((data) => {
          // Check if the post has been downvoted previously
          if (data.empty) {
            // If the post hasn't been downvoted, increase vote score by 1
            postData.voteScore++;
            postDocument.update({ voteScore: postData.voteScore });

            // Return upvotes and downvotes collections
            return db
              .collection('postUpvotes')
              .where('postId', '==', req.params.postId)
              .get()

              .then((data) => {
                data.forEach((doc) => {
                  const upvote = doc.data();
                  upvote.id = doc.id;
                  upvotes.push(upvote);
                });

                return db
                  .collection('postDownvotes')
                  .where('postId', '==', req.params.postId)
                  .get();
              })
              .then((data) => {
                data.forEach((doc) => {
                  const downvote = doc.data();
                  downvote.id = doc.id;
                  downvotes.push(downvote);
                });

                // Save posts data to Algoria
                axios.get(
                  'https://us-central1-readable-bf7a6.cloudfunctions.net/addFirestoreDataToAlgoria'
                );

                return res.json({
                  postId: postData.id,
                  voteScore: postData.voteScore,
                  upvotes: upvotes,
                  downvotes: downvotes,
                });
              });
          } else {
            // If the post has been downvoted previously, delete previous downvote and increase voteScore by 2
            return db
              .doc(`/postDownvotes/${data.docs[0].id}`)
              .delete()
              .then(() => {
                postData.voteScore += 2;
                postDocument.update({ voteScore: postData.voteScore });

                // Return upvotes and downvotes collections
                return db
                  .collection('postUpvotes')
                  .where('postId', '==', req.params.postId)
                  .get();
              })
              .then((data) => {
                data.forEach((doc) => {
                  const upvote = doc.data();
                  upvote.id = doc.id;
                  upvotes.push(upvote);
                });

                return db
                  .collection('postDownvotes')
                  .where('postId', '==', req.params.postId)
                  .get();
              })
              .then((data) => {
                data.forEach((doc) => {
                  const downvote = doc.data();
                  downvote.id = doc.id;
                  downvotes.push(downvote);
                });

                // Save posts data to Algoria
                axios.get(
                  'https://us-central1-readable-bf7a6.cloudfunctions.net/addFirestoreDataToAlgoria'
                );

                return res.json({
                  postId: postData.id,
                  voteScore: postData.voteScore,
                  upvotes: upvotes,
                  downvotes: downvotes,
                });
              });
          }
        });
      } else {
        // If the post has been upvoted, remove upvote and decrease vote score by 1
        return db
          .doc(`/postUpvotes/${data.docs[0].id}`)
          .delete()
          .then(() => {
            postData.voteScore--;
            postDocument.update({ voteScore: postData.voteScore });

            // Return upvotes and downvotes collections
            return db
              .collection('postUpvotes')
              .where('postId', '==', req.params.postId)
              .get();
          })
          .then((data) => {
            data.forEach((doc) => {
              const upvote = doc.data();
              upvote.id = doc.id;
              upvotes.push(upvote);
            });

            return db
              .collection('postDownvotes')
              .where('postId', '==', req.params.postId)
              .get();
          })
          .then((data) => {
            data.forEach((doc) => {
              const downvote = doc.data();
              downvote.id = doc.id;
              downvotes.push(downvote);
            });

            // Save posts data to Algoria
            axios.get(
              'https://us-central1-readable-bf7a6.cloudfunctions.net/addFirestoreDataToAlgoria'
            );

            return res.json({
              postId: postData.id,
              voteScore: postData.voteScore,
              upvotes: upvotes,
              downvotes: downvotes,
            });
          });
      }
    })
    .catch((err) => {
      res.status(500).json({ error: err.code });
    });
};

// Toggle post downvote
exports.togglePostDownvote = (req, res) => {
  const upvoteDocument = db
    .collection('postUpvotes')
    .where('userName', '==', req.user.userName)
    .where('postId', '==', req.params.postId)
    .limit(1);

  const downvoteDocument = db
    .collection('postDownvotes')
    .where('userName', '==', req.user.userName)
    .where('postId', '==', req.params.postId)
    .limit(1);

  const postDocument = db.doc(`posts/${req.params.postId}`);

  let upvotes = [];
  let downvotes = [];
  let postData = {};

  postDocument
    .get()
    .then((doc) => {
      if (doc.exists) {
        postData = doc.data();
        postData.id = doc.id;

        return downvoteDocument.get();
      } else {
        return res.status(404).json({ error: 'Post not found' });
      }
    })
    .then((data) => {
      // Check if the post has been downvoted
      if (data.empty) {
        // If the post hasn't been downvoted, add downvote
        db.collection('postDownvotes').add({
          postId: req.params.postId,
          userName: req.user.userName,
        });
        return upvoteDocument.get().then((data) => {
          // Check if the post has been upvoted previously
          if (data.empty) {
            // If the post hasn't been upvoted, decrease vote score by 1
            postData.voteScore--;
            postDocument.update({ voteScore: postData.voteScore });

            // Return upvotes and downvotes collections
            return db
              .collection('postDownvotes')
              .where('postId', '==', req.params.postId)
              .get()

              .then((data) => {
                data.forEach((doc) => {
                  const downvote = doc.data();
                  downvote.id = doc.id;
                  downvotes.push(downvote);
                });

                return db
                  .collection('postUpvotes')
                  .where('postId', '==', req.params.postId)
                  .get();
              })
              .then((data) => {
                data.forEach((doc) => {
                  const upvote = doc.data();
                  upvote.id = doc.id;
                  upvotes.push(upvote);
                });

                // Save posts data to Algoria
                axios.get(
                  'https://us-central1-readable-bf7a6.cloudfunctions.net/addFirestoreDataToAlgoria'
                );

                return res.json({
                  postId: postData.id,
                  voteScore: postData.voteScore,
                  upvotes: upvotes,
                  downvotes: downvotes,
                });
              });
          } else {
            // If the post has been upvoted previously, delete previous upvote and decrease voteScore by 2
            return db
              .doc(`/postUpvotes/${data.docs[0].id}`)
              .delete()
              .then(() => {
                postData.voteScore -= 2;
                postDocument.update({ voteScore: postData.voteScore });

                // Return upvotes and downvotes collections
                return db
                  .collection('postDownvotes')
                  .where('postId', '==', req.params.postId)
                  .get();
              })
              .then((data) => {
                data.forEach((doc) => {
                  const downvote = doc.data();
                  downvote.id = doc.id;
                  downvotes.push(downvote);
                });

                return db
                  .collection('postUpvotes')
                  .where('postId', '==', req.params.postId)
                  .get();
              })
              .then((data) => {
                data.forEach((doc) => {
                  const upvote = doc.data();
                  upvote.id = doc.id;
                  upvotes.push(upvote);
                });

                // Save posts data to Algoria
                axios.get(
                  'https://us-central1-readable-bf7a6.cloudfunctions.net/addFirestoreDataToAlgoria'
                );

                return res.json({
                  postId: postData.id,
                  voteScore: postData.voteScore,
                  upvotes: upvotes,
                  downvotes: downvotes,
                });
              });
          }
        });
      } else {
        // If the post has been downvoted, remove downvote and increase vote score by 1
        return db
          .doc(`/postDownvotes/${data.docs[0].id}`)
          .delete()
          .then(() => {
            postData.voteScore++;
            postDocument.update({ voteScore: postData.voteScore });

            // Return upvotes and downvotes collections
            return db
              .collection('postDownvotes')
              .where('postId', '==', req.params.postId)
              .get();
          })
          .then((data) => {
            data.forEach((doc) => {
              const downvote = doc.data();
              downvote.id = doc.id;
              downvotes.push(downvote);
            });

            return db
              .collection('postUpvotes')
              .where('postId', '==', req.params.postId)
              .get();
          })
          .then((data) => {
            data.forEach((doc) => {
              const upvote = doc.data();
              upvote.id = doc.id;
              upvotes.push(upvote);
            });

            // Save posts data to Algoria
            axios.get(
              'https://us-central1-readable-bf7a6.cloudfunctions.net/addFirestoreDataToAlgoria'
            );

            return res.json({
              postId: postData.id,
              voteScore: postData.voteScore,
              upvotes: upvotes,
              downvotes: downvotes,
            });
          });
      }
    })
    .catch((err) => {
      res.status(500).json({ error: err.code });
    });
};
