import React from 'react'
import { FaUser } from 'react-icons/fa';
import "./Profile.css";
import Profilelink from './Profilelink';

const links = [
  {
    id: 1,
    title: 'Twitter',
    url: 'https://twitter.com/',
   category:"google"
  },
  {
    id: 2,
    title: 'Facebook',
    url: 'https://facebook.com/',
   category:"google"
  },
  {
    id: 3,
    title: 'Instagram',
    url: 'https://instagram.com/',
   category:"google"
  },
  {
    id: 4,
    title: 'Youtube',
    url: 'https://youtube.com/',
       category:"google"
  },
]
const users = [
  {
    id: 1,
    name: 'User1',
    email: 'xyz@gmail.com',
  },
  {
    id: 1,
    name: 'User1',
    email: 'xyz@gmail.com',
  }
]
function Profile() {
  return (
    <div className='Profile'>
     <div className='User-section'>
      <div className='User-sub'>
        <h1>Profile</h1>
        <div className='User-image'>
          <FaUser className="fadummyuser" />
        </div>
        <div className='User-name'>
          <h2>Username</h2>
        </div>
        <div className='User-email'>
          <h2>abc.@gmail.com</h2>
        </div>
        <div className='User-bio'>
        <p>Lorem ipsum dolor, sit amet consectetur adipisicing elit. Rem consectetur quos perspiciatis animi. Debitis ab ex ipsa fuga earum tempora aliquam tempore eveniet? Quisquam voluptate in, obcaecati nostrum commodi harum!</p>
        </div>
      </div>
    </div> 
    <div className='Links-Users'>
    <div className='Links'>
      <div className='Sub-link'>
      <h1>Links</h1>
        {
            links.map((link) => {
              const { id, title, url,category } = link
              return (
              <Profilelink key={id} title={title} url={url} category={category}/>
              )
            })
        } 
      </div>
      </div>
      <div className='Users'>
      <div className='Sub-link'>
      <h1>Users</h1>
        {
            users.map((user) => {
              const { id, name, email } = user
              return (
              <Profilelink key={id} title={name} url={email} />
              )
            })
        } 
      </div>

      </div>
    </div>
    </div>
  )
}

export default Profile
