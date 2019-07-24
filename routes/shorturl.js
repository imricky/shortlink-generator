const express = require('express');
const router = express.Router();
const mysql = require('mysql')
const query = require('../util/dbhelper')
const redis = require("redis"),
  client = redis.createClient();

const { promisify } = require('util');
const setAsync = promisify(client.set).bind(client);
const getAsync = promisify(client.get).bind(client);


const SHORT_LINK_PREFIX = 'expressShortlink';
const EXPIRE_TIME = 60 * 60 * 24 * 365; //过期时间存成1年

router.get('/', (req, res, next) => {
  res.send('接口get成功了')
})

router.post('/', async (req, res, next) => {
  let userURL = req.body.userURL;
  let returnObj = {
    code: 200,
    success: true,
    message: '成功',
    short_link: null,
    long_link: userURL
  }
  let shortLinkInDatabase = await isExistShortlink(userURL);
  //如果数据库里已经有长网址了，直接返回短网址结果
  if (shortLinkInDatabase !== null) {
    return res.json({
      code: 204,
      message: '短链接已存在',
      short_link: shortLinkInDatabase,
      long_link: userURL
    });
  }
  //生成短链接
  let maxPhid = await GetMaxPhid();
  let short_link = string10to62(maxPhid);
  let params = {
    long_link: userURL,
    short_link: short_link
  }
  //插入数据库
  let success = await storeShortLink(params);
  if (!success) {
    return res.json({
      code: 500,
      success: false,
      message: '数据库插入错误',
    })
  }
  res.json({
    code: 200,
    message: '成功',
    short_link: short_link,
    long_link: userURL
  })
})



//10进制转62进制
//3843 对应61*62^0+61*62^1    3844对应100
function string10to62(number) {
  const chars = '0123456789abcdefghigklmnopqrstuvwxyzABCDEFGHIGKLMNOPQRSTUVWXYZ';
  const charsArr = chars.split('');
  const radix = chars.length;
  let qutient = +number;
  let arr = [];
  do {
    let mod = qutient % radix;
    qutient = (qutient - mod) / radix;
    arr.unshift(charsArr[mod]);
  } while (qutient);
  return arr.join('');
}

//获取最大phid
async function GetMaxPhid() {
  let sql = 'select max(phid) as phid from fg_shortlink'
  let maxPhid = await query(sql);
  let final = maxPhid[0].phid + 1;
  return final
}

//查找数据库是否存在对应的短网址是否存在。
async function isExistShortlink(long_link) {
  let sql = 'select * from fg_shortlink where long_link = ?'
  let result = await query(sql, [long_link]);
  if (result.length === 0) {
    return null;
  } else {
    return result[0].short_link
  }
}


//存短链接
async function storeShortLink(params) {
  let { long_link, short_link } = params;
  let success = false; //判断是否成功
  let post = {
    long_link: long_link,
    short_link: short_link,
    type: 1, //1 表示系统生成，2表示用户自定义
    inserted_at: new Date().valueOf(),
    updated_at: new Date().valueOf(),
  };
  //存MySQL：
  try {
    let resultMySQL = await query('INSERT INTO fg_shortlink SET ?', post);
    if (resultMySQL.affectedRows === 1) {
      success = true;
    }
  } catch (e) {
    console.log(e)
  }
  //存redis
  if (success === true) {
    let resultRedis = await setAsync(`${SHORT_LINK_PREFIX}##${short_link}`, long_link, 'EX', EXPIRE_TIME)
    success = resultRedis === "OK"
  }
  return success
}


//查找长链接，用于跳转
async function queryLink(short_link) {
  //先去redis里查
  let resRedis = await getAsync(`${SHORT_LINK_PREFIX}##${short_link}`);
  if (resRedis !== null) {
    return resRedis
  }
  //redis里没找到就去找MySQL
  let resMySQL = await query('select long_link from fg_shortlink where short_link = ?', [short_link]);
  if (resMySQL && resMySQL.length > 0) {
    const long_link = resMySQL[0].long_link;
    //同步redis
    await setAsync(`${SHORT_LINK_PREFIX}##${short_link}`, long_link, 'EX', EXPIRE_TIME);
    return long_link;
  }

  return null; //找不到返回空
}

module.exports = router