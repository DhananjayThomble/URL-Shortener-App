import React from 'react'
import "./Profilelink.css";
import { Link } from 'react-router-dom';
function Profilelink(props) {
    return (
        <div>
            <Link to={props.url}>
            <div key={props.id} className='link'>
                <div className='Link-title'>
                    <h2>{props.title}</h2>
                </div>
                <div className='Link-url'>
                    <h2>{props.url}</h2>
                </div>
            </div>
            </Link>
        </div>
    )
}

export default Profilelink
