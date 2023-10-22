import React from 'react'
import "./Profilelink.css";
import { Link } from 'react-router-dom';
function Profilelink(props) {
    return (
        <div>
            <Link to={props.url}>
            <div key={props.id} className='Link'>
                <div className='Link-title'>
                    <h2 id='linkh'>{props.title}</h2>
                </div>
                <div className='Link-url'>
                    <h3 id='linku'>{props.url}</h3>
                </div>
                <h3>{props.category}</h3>
            </div>
            </Link>
        </div>
    )
}

export default Profilelink
