exports.formatResponsePosts = (arr) => {
  let obj = {};
  arr.forEach((item) => {
    obj[item.id] = {
      ...item,
    };
  });
  return obj;
};

exports.formatResponseUsers = (arr) => {
  let obj = {};
  arr.forEach((item) => {
    obj[item.userName] = {
      ...item,
    };
  });
  return obj;
};
