function classifyPattern(triggeringFibers) {
  if (triggeringFibers.withSuspense.length > 0) {
    return {
      pattern: 'lazy-in-render',
      suspects: triggeringFibers.withSuspense,
      evidence: 'Triggering commit had Suspense boundary with DidCapture flag',
    };
  }

  if (triggeringFibers.withLayoutEffects.length > 0) {
    return {
      pattern: 'setState-in-layout-effect',
      suspects: triggeringFibers.withLayoutEffects,
      evidence: 'Triggering commit had fibers with layout effect flags',
    };
  }

  return {
    pattern: 'setState-outside-react',
    suspects: triggeringFibers.withUpdates,
    evidence: 'No layout effects or suspense in triggering commit; ' +
              'likely unbatched setState in promise/setTimeout (legacy mode)',
  };
}

module.exports = { classifyPattern };
