import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';
import './index.css';

// Legacy ReactDOM.render — required for unbatched setState test case
// React 18 deprecation warning in console is expected
ReactDOM.render(<App />, document.getElementById('app'));
