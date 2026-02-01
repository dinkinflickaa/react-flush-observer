import { install } from 'react-flush-observer';
import { initLog, appendDetection } from './detection-log';

// Init the vanilla DOM detection log
initLog(document.getElementById('detection-log'));

// Install the observer BEFORE React is imported — React reads
// __REACT_DEVTOOLS_GLOBAL_HOOK__ during its module initialization
install({ onDetection: appendDetection });

// Dynamically import the app AFTER the hook is installed
import('./main.jsx');
