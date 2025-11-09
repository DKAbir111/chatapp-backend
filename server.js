const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatapp';

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ MongoDB Error:', err));

// Message Schema
const messageSchema = new mongoose.Schema({
    text: { type: String, required: true },
    sender: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    reactions: {
        type: Map,
        of: [String],
        default: {}
    }
});

const Message = mongoose.model('Message', messageSchema);

// Socket.io Connection
io.on('connection', (socket) => {
    console.log('👤 User connected:', socket.id);

    // Send existing messages to new user
    Message.find()
        .sort({ timestamp: 1 })
        .limit(100)
        .then(messages => {
            socket.emit('load-messages', messages);
        });

    // Handle new message
    socket.on('send-message', async (data) => {
        try {
            const message = new Message({
                text: data.text,
                sender: data.sender,
                reactions: {}
            });

            await message.save();

            // Broadcast to all connected users
            io.emit('new-message', message);
        } catch (error) {
            console.error('Error saving message:', error);
            socket.emit('error', { message: 'Failed to send message' });
        }
    });

    // Handle reactions
    socket.on('add-reaction', async (data) => {
        try {
            const message = await Message.findById(data.messageId);
            if (!message) return;

            const reactions = message.reactions || new Map();
            const emoji = data.emoji;
            const username = data.username;

            if (reactions.has(emoji)) {
                const users = reactions.get(emoji);
                if (users.includes(username)) {
                    // Remove reaction
                    const filtered = users.filter(u => u !== username);
                    if (filtered.length === 0) {
                        reactions.delete(emoji);
                    } else {
                        reactions.set(emoji, filtered);
                    }
                } else {
                    // Add reaction
                    users.push(username);
                    reactions.set(emoji, users);
                }
            } else {
                // New reaction
                reactions.set(emoji, [username]);
            }

            message.reactions = reactions;
            await message.save();

            // Broadcast reaction update
            io.emit('reaction-updated', {
                messageId: message._id,
                reactions: Object.fromEntries(reactions)
            });
        } catch (error) {
            console.error('Error adding reaction:', error);
        }
    });

    socket.on('disconnect', () => {
        console.log('👤 User disconnected:', socket.id);
    });
});

// API Routes
app.get('/api/messages', async (req, res) => {
    try {
        const messages = await Message.find()
            .sort({ timestamp: 1 })
            .limit(100);
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});