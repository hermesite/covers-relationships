import React from 'react';
import { Link } from 'react-router-dom';

import './index.css';

const VISUALISATIONS = [
  {
    number: '01',
    title: 'Originals',
    path: '/originals',
    description: 'Trace an artist\'s original recordings and the performers who covered them.',
    type: 'Network graph',
  },
  {
    number: '02',
    title: 'Covers',
    path: '/covers',
    description: 'Follow the songs an artist covered back to their original performers.',
    type: 'Network graph',
  },
  {
    number: '03',
    title: 'Cover Cards',
    path: '/covers-cards',
    description: 'Browse covered songs grouped by the artists who performed them first.',
    type: 'Card collection',
  },
  {
    number: '04',
    title: 'Band Detail',
    path: '/band-detail',
    description: 'Explore an artist\'s related people and their roles, identities, and credits.',
    type: 'Artist profile',
  },
];

function Home() {
  return (
    <main className='home-page'>
      <header className='home-hero'>
        <div className='container home-hero-inner'>
          <div className='home-hero-copy'>
            <p className='home-eyebrow'>An exploration of recorded music</p>
            <h1>Secondhand<br />Covers</h1>
            <p className='home-hero-lead'>Every cover has a story behind it.</p>
            <p className='home-hero-description'>Explore the relationships between songs, original performers, and the artists who reinterpret them. Identify original recordings, map cover versions, and reveal connections between artists.</p>
            <a className='home-hero-link' href='#visualisations'>Explore the visualisations <span aria-hidden='true'>↗</span></a>
          </div>
        </div>
      </header>

      <section className='home-index' id='visualisations' aria-labelledby='home-index-title'>
        <div className='container'>
          <div className='home-index-heading'>
            <div>
              <p className='home-eyebrow'>Explore the project</p>
              <h2 id='home-index-title'>Visualisations</h2>
            </div>
            <p>Four ways to explore connections between artists and recordings.</p>
          </div>
          <div className='home-index-list'>
            {VISUALISATIONS.map(({ number, title, path, description, type }) => (
              <Link className='home-index-item' key={path} to={path}>
                <span className='home-index-number'>{number}</span>
                <span className='home-index-content'>
                  <span className='home-index-title'>{title}</span>
                  <span className='home-index-description'>{description}</span>
                </span>
                <span className='home-index-type'>{type}</span>
                <span className='home-index-arrow' aria-hidden='true'>↗</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

export default Home;
