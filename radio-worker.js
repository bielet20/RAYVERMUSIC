// Dedicated Web Worker: fires every 1 s regardless of background tab throttling.
// Chrome throttles main-thread timers in background tabs but NOT Worker timers.
setInterval(() => self.postMessage(1), 1000);
