import React from 'react'
import { FaUser } from 'react-icons/fa';
import "./usercard.css";

function pusercard(props) {
    return (
        <div className='User-card'>
            <div className='User-image'>
                <FaUser className="fadummyuser" />
            </div>
            <div className='User-data'>
                <h2>{props.name}</h2>
                <h3>{props.email}</h3>
            </div>
        </div>
    )
}

export default pusercard
