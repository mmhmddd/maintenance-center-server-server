import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';

// Load environment variables
dotenv.config();

// Connect to the database
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to the database successfully');
  } catch (error) {
    console.error('Error connecting to the database:', error);
    process.exit(1);
  }
};

// Function to make a user an admin
const makeUserAdmin = async (email) => {
  try {
    // Find the user by email
    const user = await User.findOne({ email });
    if (!user) {
      console.error(`No user found with email: ${email}`);
      return;
    }

    // Check if the user is already an admin
    if (user.role === 'admin') {
      console.log(`User ${email} is already an admin!`);
      return;
    }

    // Update the user's role to 'admin'
    user.role = 'admin';
    await user.save();

    console.log(`User ${email} has been successfully made an admin!`);
  } catch (error) {
    console.error('Error updating user:', error);
  } finally {
    // Close the database connection
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
};

// Execute the script
const run = async () => {
  await connectDB();
  await makeUserAdmin('mohamed.m.mahmoud29@gmail.com'); // Updated email
};

run();