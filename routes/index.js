var express = require('express');
var router = express.Router();
const passport = require('passport');
const users = require('../models/usermodel')
const songModel = require('../models/songmodel')
const playlistModel = require('../models/playlistmodel')
const mongoose = require('mongoose')
const multer = require('multer')
var id3 = require('node-id3')
const {Readable} = require('stream')
const crypto = require('crypto')
var userModel = require('../models/usermodel')

mongoose.connect('mongodb+srv://pummysahu04:93mWPgsmgTAeZLu0@pummy.zy9kofm.mongodb.net/spotify?retryWrites=true&w=majority').then(() => {
  console.log('connected to database')
}).catch(err => {
  console.log(err)
})

/* GET home page. */
router.get('/',isloggedIn,async function(req, res, next) {
  const currentUser = await userModel.findOne({
    _id: req.user._id,

  }).populate('playlist').populate({
    path:'playlist',
    populate:{
      path: 'songs',
      model: 'song'
    }
  })


  const playlists = currentUser.playlist.filter(playlist => playlist.owner.equals(currentUser._id))
  res.render('index', {currentUser,playlists});
});


router.get('/auth', function(req,res,next){
  res.render('register')
})

// user authentication-------------------
const localStrategy = require("passport-local")
passport.use(new localStrategy(users.authenticate()))

router.post('/register', async function(req,res,next){
  var newUser = {
    username: req.body.username,
    email: req.body.email,
    contact: req.body.contact
  }
  users.register(newUser, req.body.password)
  .then(function(u){
    passport.authenticate('local')(req,res,async function(){

      const songs = await songModel.find()
      const defaultplaylist = await playlistModel.create({
        name: 'default',
        owner: req.user._id,
        songs: songs.map(song => song._id)
      })
      const newUser = await userModel.findOne({
        _id: req.user._id
      })

      newUser.playlist.push(defaultplaylist._id)

      await newUser.save()


      res.redirect('/')
    })
  })
  .catch(function(e){
    res.send(e)
  })
})

router.post('/login',passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login',
  }),
  (req, res, next) => { }
);

router.get('/logout', (req, res, next) => {
  if (req.isAuthenticated())
    req.logout((err) => {
      if (err) res.send(err);
      else res.redirect('/auth');
    });
  else {
    res.redirect('/auth');
  }
});

function isloggedIn(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  else res.redirect('/auth');
}

function isAdmin(req,res,next){
  if(req.user.isAdmin){
    return next()
  } 
  else {
    return res.redirect('/')
}
}


router.get('/login',function(req,res,next){
  res.render('login')
})

router.get('/signup',function(req,res,next){
  res.render('register')
})


// ------------------------------

// uploadmusic-------------------------
const storage = multer.memoryStorage()
const upload = multer({ storage: storage })

const conn = mongoose.connection

var gfsBucket, gfsBucketPoster
conn.once('open', () => {
  gfsBucket = new mongoose.mongo.GridFSBucket(conn.db, {
    bucketName: 'audio'
  })
  gfsBucketPoster = new mongoose.mongo.GridFSBucket(conn.db, {
    bucketName: 'poster'
  })
})

router.post('/uploadMusic',isloggedIn,isAdmin, upload.array('song'),async function(req,res,next){
  await Promise.all(req.files.map(async file => {
    const randomName = crypto.randomBytes(20).toString('hex')

    const songData = id3.read(file.buffer)
    Readable.from(file.buffer).pipe(gfsBucket.openUploadStream(randomName))
    Readable.from(songData.image.imageBuffer).pipe(gfsBucketPoster.openUploadStream(randomName + 'poster'))

    await songModel.create({
      title: songData.title,
      artist: songData.artist,
      album: songData.album,
      size: file.size,
      poster: randomName + 'poster',
      filename: randomName
    })
  }))

  res.send('upload')
})

router.get('/uploadMusic',isloggedIn,isAdmin, function(req,res,next){
  res.render('uploadMusic')
})

router.get('/poster/:posterName', (req, res, next) => {
  gfsBucketPoster.openDownloadStreamByName(req.params.posterName).pipe(res)
})

router.get('/stream/:musicName', async (req, res, next) => {
  const currentSong = await songModel.findOne({
    filename: req.params.musicName
  })
  console.log(currentSong)
  const stream = gfsBucket.openDownloadStreamByName(req.params.musicName)
  res.set('Content-Type', 'audio/mpeg')
  res.set('Content-Length', currentSong.size + 1)
  res.set('Content-Range', `bytes 0-${currentSong.size - 1}/${currentSong.size}`)
  res.set('Content-Ranges', 'byte')
  res.status(206)
  stream.pipe(res)
})

router.get('/search', (req, res, next) => {
  res.render('search')
})

router.post('/search', async (req, res, next) => {
  // console.log(req.body)
  const searhedMusic = await songModel.find({
    title: { $regex: req.body.search }
  })

  res.json({
    songs: searhedMusic
  })

})


// router.get('/likedsong/:filename', isloggedIn , function(req,res,next){
//   songModel.findOne({filename : req.params.filename})
//   .then(function(likedsong){
//     res.render('/likedsongs',{likedsong})
//   })
// })


router.post('/like/:songId', isloggedIn ,async function(req,res,next){

  try{
    const{ songId} = req.params
    // find the current user
    const currentUser = await userModel.findById(req.user._id)
    // check if the user already like a song
    const alreadylikes = currentUser.liked.includes(songId)
    if(alreadylikes){
      // if already like remove the song from likes
      currentUser.liked = currentUser.liked.filter(id => id.toString() !== songId)
    }else{
      // if not like add the song
      currentUser.liked.push(songId)
    }
    await currentUser.save()

    res.redirect('back')
  }
  catch(err){
    console.error(err)
    res.status(500).json({success: false, message: 'error linking'})
  }
})

router.get('/likedsong',isloggedIn,async function(req,res,next){
  try{
    const currentUser = await users.findById(req.user._id).populate('liked')
    res.render('likedsong',{likedsong: currentUser.liked , currentUser})
  }
  catch(err){
    console.error(err)
  }
})


router.post('/createplaylist', isloggedIn , async(req,res,next)=>{
  try{
    const currentUser = await userModel.findById(req.user._id)
    const newplaylist = await playlistModel.create({
      name: req.body.name,
      owner: req.user._id
    })

    currentUser.playlist.push(newplaylist._id)
    await currentUser.save()

    res.redirect('/')
  }catch(err){
    console.error(err)
    res.status(500).send("error ")
  }
})

router.get('/playlist/:playlistId',isloggedIn, async(req,res,next)=>{
    try{
      const{playlistId} = req.params
      const playlist = await playlistModel.findById(playlistId).populate('songs')
      res.render('playlist' , {playlist})
    }catch(err){
      console.error(err)
      res.status(500).send("error")
    }
})


router.post('/playlist/:playlistId/addsong/:songId', isloggedIn,async function(req,res,next){
  try{
    const{playlistId, songId} = req.params
    const playlist = await playlistModel.findById(playlistId)
    playlist.songs.push(songId)
    await playlist.save()
    res.redirect(`/playlist/${playlistId}`)
  }catch(err){
    console.error(err)
    res.status(500).send("error agaya...!")
  }
})

router.post('/playlist/:playlistId/removesong/:songId', isloggedIn,async function(req,res,next){
  try{
    const{playlistId, songId} = req.params
    const playlist = await playlistModel.findById(playlistId)
    playlist.songs = playlist.songs.filter(song=> !song.equals(songId))
    await playlist.save()
    res.redirect(`/playlist/${playlistId}`)
  }catch(err){
    console.error(err)
    res.status(500).send("error agaya...!")
  }
})




// router.get('/newplaylist',isloggedIn, function(req,res,next){
//     res.render('playlist')
// })


module.exports = router;
