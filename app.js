const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const { body, validationResult } = require('express-validator');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
const { phoneNumberFormatter } = require('./helpers/formatter');
const fileUpload = require('express-fileupload');
const axios = require('axios');
const mime = require('mime-types');
const path = require('path');

const port = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));

/**
 * BASED ON MANY QUESTIONS
 * Actually ready mentioned on the tutorials
 * 
 * Many people confused about the warning for file-upload
 * So, we just disabling the debug for simplicity.
 */
app.use(fileUpload({
    debug: false
}));

app.get('/', (req, res) => {
    res.sendFile('index.html', {
        root: __dirname
    });
});
app.use(express.static('public'));

// app.get('/', [], async (req, res) => {
//     const errors = validationResult(req).formatWith(({
//         msg
//     }) => {
//         return msg;
//     });

//     if (!errors.isEmpty()) {
//         return res.status(422).json({
//             status: false,
//             message: errors.mapped()
//         });
//     }
//     res.sendFile('index.html', {
//         root: __dirname
//     });
//     const allChats = await client.getChats();
//     const lastFiftyChats = allChats.splice(0, 50);
//     if(lastFiftyChats) {
//         io.on('connection', function (socket) {
//             socket.emit('getContact', lastFiftyChats);
//         });
//     }
// });

const client = new Client({
    restartOnAuthFail: true,
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // <- this one doesn't works in Windows
            '--disable-gpu'
        ],
    },
    authStrategy: new LocalAuth()
});

client.on('message', msg => {

    if (msg.body == 'ping') {
        msg.reply('Pesan ini dibalas oleh bot!');
    } else if (msg.body == 'good morning') {
        msg.reply('selamat pagi');
    } else if (msg.body == '!groups') {
        client.getChats().then(chats => {
            const groups = chats.filter(chat => chat.isGroup);

            if (groups.length == 0) {
                msg.reply('You have no group yet.');
            } else {
                let replyMsg = '*YOUR GROUPS*\n\n';
                groups.forEach((group, i) => {
                    replyMsg += `ID: ${group.id._serialized}\nName: ${group.name}\n\n`;
                });
                replyMsg += '_You can use the group id to send a message to the group._'
                msg.reply(replyMsg);
            }
        });
    }

    // NOTE!
    // UNCOMMENT THE SCRIPT BELOW IF YOU WANT TO SAVE THE MESSAGE MEDIA FILES
    // Downloading media
    // if (msg.hasMedia) {
    //   msg.downloadMedia().then(media => {
    //     // To better understanding
    //     // Please look at the console what data we get
    //     console.log(media);

    //     if (media) {
    //       // The folder to store: change as you want!
    //       // Create if not exists
    //       const mediaPath = './public/img/';

    //       if (!fs.existsSync(mediaPath)) {
    //         fs.mkdirSync(mediaPath);
    //       }

    //       // Get the file extension by mime-type
    //       const extension = mime.extension(media.mimetype);

    //       // Filename: change as you want! 
    //       // I will use the time for this example
    //       // Why not use media.filename? Because the value is not certain exists
    //       const filename = new Date().getTime();

    //       const fullFilename = mediaPath + filename + '.' + extension;

    //       // Save to file
    //       try {
    //         fs.writeFileSync(fullFilename, media.data, { encoding: 'base64' }); 
    //         console.log('File downloaded successfully!', fullFilename);
    //       } catch (err) {
    //         console.log('Failed to save the file:', err);
    //       }
    //     }
    //   });
    // }
});

client.initialize();

// Socket IO
io.on('connection', function (socket) {

    socket.emit('message', 'Menghububugkan...');

    // const allChats = client.getChats();
    // socket.emit('getContact', client.getChats());

    client.on('qr', (qr) => {
        console.log('QR RECEIVED', qr);
        qrcode.toDataURL(qr, (err, url) => {
            socket.emit('qr', url);
            socket.emit('message', 'QR Code received, scan please!');
        });
    });

    client.on('authenticated', () => {
        socket.emit('authenticated', 'Whatsapp is authenticated!');
        socket.emit('message', 'Whatsapp is authenticated!');
        console.log('AUTHENTICATED');
    });

    client.on('auth_failure', function (session) {
        socket.emit('message', 'Auth failure, restarting...');
        console.log(session);
    });

    client.on('disconnected', (reason) => {
        socket.emit('message', 'Whatsapp is disconnected!');
        client.destroy();
        client.initialize();
    });

    client.on('ready', async function () {
        console.log('client ready');
        // let isChatIn = await contactInit();
        // socket.emit('getContact', isChatIn);
        // console.log('sinkronkan kontak akses pertama');
        
    });

    client.on('message', async function () {
        let isChatIn = await contactInit();
        socket.emit('getContact', isChatIn);
        console.log('sinkronkan kontak karena chat masuk');
    });

    socket.on('client request', async function(msg) {
        let isChatIn = await contactInit();
        socket.emit('getContact', isChatIn);
        console.log('sinkronkan kontak karena chat masuk');
        console.log(msg);
    });

    socket.on('sentMessage', async function(data){
        console.log(data);
        const number = phoneNumberFormatter(data.nomor);
        const message = data.message;
    
        const isRegisteredNumber = await checkRegisteredNumber(number);
    
        if (!isRegisteredNumber) {
            socket.emit('log', 'nomor tidak terdaftar');
        }
    
        client.sendMessage(number, message).then(response => {
            socket.emit('kirim chat sukses', data.nomor);
        }).catch(err => {
            socket.emit('log', err);
        });
    });

    socket.on('getchatbyid', async function(msg) {
        const number = phoneNumberFormatter(msg.toString().replace(/[^0-9]/g, '')) || 0;
        const chat = await client.getChatById(number);
        // console.log(chat.fetchMessages({limit:1}));
        // console.log('Sukses mendapatkan data chat dari' + number);
        
        chat.fetchMessages({limit:1000}).then(messages => {
            socket.emit('log', 'getchatbyid diterima server');
            async function loopDulu() {
                // console.log('mendapatkan chat dari nomor'+number);
                messages.forEach(getDataChat);
            };
    
            loopDulu().then( () => {
                socket.emit('chat by number', messages);
            });
        })
    });
});

const getDataChat = async function (value, index, array) {
    if (value.hasMedia) {
        value.downloadMedia().then(media => {
          // To better understanding
          // Please look at the console what data we get
        //   console.log(media);
  
          if (media) {
            // The folder to store: change as you want!
            // Create if not exists
            const mediaPath = './public/img/';
  
            if (!fs.existsSync(mediaPath)) {
              fs.mkdirSync(mediaPath, {recursive: true}, err => {});
            }
  
            // Get the file extension by mime-type
            const extension = mime.extension(media.mimetype);
  
            // Filename: change as you want! 
            // I will use the time for this example
            // Why not use media.filename? Because the value is not certain exists
            const filename = new Date().getTime();
  
            const fullFilename = mediaPath + value.id.id + '.' + extension;
            // Save to file
            try {
                fs.writeFileSync(fullFilename, media.data, { encoding: 'base64' }); 
                // console.log('File downloaded successfully! ', fullFilename);
            } catch (err) {
            //   console.log('Failed to save the file:', err);
            }
          }
        });
    }
}

const contactInit = async function () {
    console.log('mendapatkan list chat');
    const allChats = await client.getChats();
    const obj = [];
    // console.log(allChats[0]);
    
    for (var i = 0, l = allChats.length; i < l; i++) {
        const number = phoneNumberFormatter(allChats[i]?.id?.user.replace(/[^0-9]/g, '')) || 0;
        //  console.log(allChats[i]);
         if(allChats[i]?.id?.user.includes("-") == false){
            let chat = await client.getChatById(number);

            chat.fetchMessages({limit:1}).then(messages => {
                let firstMessages = messages[0];
                let fTime = firstMessages?.timestamp || 0;
                let fId  = firstMessages?.id?.id || 0;
                // console.log(i);
                obj.push({
                    'data':{
                        'name' : allChats[i]?.name,
                        'id' : allChats[i]?.id?.user,
                        'unreadCount' :allChats[i]?.unreadCount,
                        'caption' : firstMessages?.caption,
                        'body': firstMessages?.body,
                        'timestamp':fTime
                    }
                });
            });
         }
    }
    return obj;
}
const checkRegisteredNumber = async function (number) {
    const isRegistered = await client.isRegisteredUser(number);
    return isRegistered;
}

// Send message
// app.post('/send-message', [
//     body('number').notEmpty(),
//     body('message').notEmpty(),
// ], async (req, res) => {
//     const errors = validationResult(req).formatWith(({
//         msg
//     }) => {
//         return msg;
//     });

//     if (!errors.isEmpty()) {
//         return res.status(422).json({
//             status: false,
//             message: errors.mapped()
//         });
//     }

//     const number = phoneNumberFormatter(req.body.number);
//     const message = req.body.message;

//     const isRegisteredNumber = await checkRegisteredNumber(number);

//     if (!isRegisteredNumber) {
//         return res.status(422).json({
//             status: false,
//             message: 'The number is not registered'
//         });
//     }

//     client.sendMessage(number, message).then(response => {
//         res.status(200).json({
//             status: true,
//             response: response
//         });
//     }).catch(err => {
//         res.status(500).json({
//             status: false,
//             response: err
//         });
//     });
// });

// Send media
app.post('/send-media', async (req, res) => {
    const number = phoneNumberFormatter(req.body.number);
    const caption = req.body.caption;
    const fileUrl = req.body.file;

    // const media = MessageMedia.fromFilePath('./image-example.png');
    // const file = req.files.file;
    // const media = new MessageMedia(file.mimetype, file.data.toString('base64'), file.name);
    let mimetype;
    const attachment = await axios.get(fileUrl, {
        responseType: 'arraybuffer'
    }).then(response => {
        mimetype = response.headers['content-type'];
        return response.data.toString('base64');
    });

    const media = new MessageMedia(mimetype, attachment, 'Media');

    client.sendMessage(number, media, {
        caption: caption
    }).then(response => {
        res.status(200).json({
            status: true,
            response: response
        });
    }).catch(err => {
        res.status(500).json({
            status: false,
            response: err
        });
    });
});

const findGroupByName = async function (name) {
    const group = await client.getChats().then(chats => {
        return chats.find(chat =>
            chat.isGroup && chat.name.toLowerCase() == name.toLowerCase()
        );
    });
    return group;
}

// Send message to group
// You can use chatID or group name, yea!
app.post('/send-group-message', [
    body('id').custom((value, { req }) => {
        if (!value && !req.body.name) {
            throw new Error('Invalid value, you can use `id` or `name`');
        }
        return true;
    }),
    body('message').notEmpty(),
], async (req, res) => {
    const errors = validationResult(req).formatWith(({
        msg
    }) => {
        return msg;
    });

    if (!errors.isEmpty()) {
        return res.status(422).json({
            status: false,
            message: errors.mapped()
        });
    }

    let chatId = req.body.id;
    const groupName = req.body.name;
    const message = req.body.message;

    // Find the group by name
    if (!chatId) {
        const group = await findGroupByName(groupName);
        if (!group) {
            return res.status(422).json({
                status: false,
                message: 'No group found with name: ' + groupName
            });
        }
        chatId = group.id._serialized;
    }

    client.sendMessage(chatId, message).then(response => {
        res.status(200).json({
            status: true,
            response: response
        });
    }).catch(err => {
        res.status(500).json({
            status: false,
            response: err
        });
    });
});

// Get list Chat
app.post('/list-pesan', [
    body('number').notEmpty(),
], async (req, res) => {
    const errors = validationResult(req).formatWith(({
        msg
    }) => {
        return msg;
    });

    if (!errors.isEmpty()) {
        return res.status(422).json({
            status: false,
            message: errors.mapped()
        });
    }

    const number = phoneNumberFormatter(req.body.number);

    const chat = await client.getChatById(number);
    // console.log(chat.fetchMessages({limit:100}));
    // console.log('Sukses mendapatkan data chat dari' + number);
    chat.fetchMessages().then(messages => {
        // console.log(messages);
        // console.log('Sukses mendapatkan data chat dari' + number);


        async function loopDulu() {
            console.log('mendapatkan chat dari nomor'+number);
            messages.forEach(getDataChat);
            
            function getDataChat(value, index, array) {
                if (value.hasMedia) {
                    value.downloadMedia().then(media => {
                      // To better understanding
                      // Please look at the console what data we get
                    //   console.log(media);
              
                      if (media) {
                        // The folder to store: change as you want!
                        // Create if not exists
                        const mediaPath = './public/img/';
              
                        if (!fs.existsSync(mediaPath)) {
                          fs.mkdirSync(mediaPath, {recursive: true}, err => {});
                        }
              
                        // Get the file extension by mime-type
                        const extension = mime.extension(media.mimetype);
              
                        // Filename: change as you want! 
                        // I will use the time for this example
                        // Why not use media.filename? Because the value is not certain exists
                        const filename = new Date().getTime();
              
                        const fullFilename = mediaPath + value.id.id + '.' + extension;
                        // Save to file
                        try {
                            fs.writeFileSync(fullFilename, media.data, { encoding: 'base64' }); 
                            // console.log('File downloaded successfully! ', fullFilename);
                        } catch (err) {
                        //   console.log('Failed to save the file:', err);
                        }
                      }
                    });
                }
            }
        };

        loopDulu().then( () => {
            // console.log('Loop Berhasil');
            res.status(200).json({
                status: true,
                response: messages
            });
        });//Yello

    }).catch(err => {
        res.status(500).json({
            status: false,
            response: err
        });
    })
});

//list contact
app.post('/list-contact', [
], async (req, res) => {
    const errors = validationResult(req).formatWith(({
        msg
    }) => {
        return msg;
    });
    let isChatIn = await contactInit();
    return isChatIn;
});

// Get list Chat
app.post('/semua-pesan', [
], async (req, res) => {
    const errors = validationResult(req).formatWith(({
        msg
    }) => {
        return msg;
    });

    if (!errors.isEmpty()) {
        return res.status(422).json({
            status: false,
            message: errors.mapped()
        });
    }

    client.getChats().then(chats => {

        var chats = client.getChats();
        new Promise(resolve => setTimeout(resolve, 5000));
        // var messages = chats.fetchMessages({limit: 100});
        var messages = chats.fetchMessages();

        return res.status(200).json({
            status: true,
            message: messages
        });
    });
});

// Clearing message on spesific chat
app.post('/clear-message', [
    body('number').notEmpty(),
], async (req, res) => {
    const errors = validationResult(req).formatWith(({
        msg
    }) => {
        return msg;
    });

    if (!errors.isEmpty()) {
        return res.status(422).json({
            status: false,
            message: errors.mapped()
        });
    }

    const number = phoneNumberFormatter(req.body.number);

    const isRegisteredNumber = await checkRegisteredNumber(number);

    if (!isRegisteredNumber) {
        return res.status(422).json({
            status: false,
            message: 'The number is not registered'
        });
    }

    const chat = await client.getChatById(number);

    chat.clearMessages().then(status => {
        res.status(200).json({
            status: true,
            response: status
        });
    }).catch(err => {
        res.status(500).json({
            status: false,
            response: err
        });
    })
});

server.listen(port, function () {
    console.log('App running on *: ' + port);
});
