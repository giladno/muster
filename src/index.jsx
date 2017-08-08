import {AppContainer} from 'react-hot-loader';
import React from 'react';
import ReactDOM from 'react-dom';
import App from './app.jsx';

const render = Component=>ReactDOM.render(<AppContainer><Component /></AppContainer>, document.getElementById('root'));

render(App);
if (module.hot)
    module.hot.accept('./app.jsx', ()=>render(App));
