require("dotenv").config();

const app = require('./app');

const PORT = 5000;

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

console.log("JWT_SECRET:", process.env.JWT_SECRET);
