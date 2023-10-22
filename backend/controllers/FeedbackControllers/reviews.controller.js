
import {  validationResult } from 'express-validator';
import Feedback from '../../models/Feedback.js'
export  const getreviews = async (req, res) => {
    try {
        const reviews = await Feedback.find({});
        console.log(reviews);
        res.status(200).json(reviews);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error" });
    }
    };