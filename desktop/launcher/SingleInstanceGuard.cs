using System.Threading;

namespace LogExplorer.Launcher;

/// <summary>
/// Legacy Remediation Slice 9 §D: robust single-instance behavior that
/// does not rely solely on "is port 3434 occupied?" as the identity
/// check (a completely unrelated process could hold that port with
/// nothing to do with Log Explorer). A named <see cref="Mutex"/> is the
/// actual identity check - only ever held by a real Log Explorer
/// process, regardless of what port it ended up choosing - and a
/// separate named <see cref="EventWaitHandle"/> is how a second launch
/// asks the first, already-running instance to bring its window to the
/// front instead of silently doing nothing.
/// </summary>
internal sealed class SingleInstanceGuard : IDisposable
{
    private const string MutexName = "LogExplorer.SingleInstance.Mutex";
    private const string ActivateEventName = "LogExplorer.ActivateRequested.Event";

    private readonly Mutex _mutex;
    private readonly EventWaitHandle _activateEvent;

    private SingleInstanceGuard(Mutex mutex, EventWaitHandle activateEvent, bool isFirstInstance)
    {
        _mutex = mutex;
        _activateEvent = activateEvent;
        IsFirstInstance = isFirstInstance;
    }

    public bool IsFirstInstance { get; }

    public static SingleInstanceGuard Acquire()
    {
        var mutex = new Mutex(initiallyOwned: true, MutexName, out var createdNew);
        var activateEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ActivateEventName);
        return new SingleInstanceGuard(mutex, activateEvent, createdNew);
    }

    /// <summary>Called by a second launch that lost the mutex race - wakes the first instance's <see cref="WatchForActivationRequests"/> loop.</summary>
    public void RequestActivationOfExistingInstance() => _activateEvent.Set();

    /// <summary>
    /// Runs on a background thread in the first instance for the whole
    /// life of the application, invoking <paramref name="onActivateRequested"/>
    /// (on the caller's thread, via whatever marshaling it performs
    /// itself - typically <c>Form.BeginInvoke</c>) every time a second
    /// launch signals it. Never throws on the caller's thread; exits
    /// quietly when <paramref name="stoppingToken"/> is signaled.
    /// </summary>
    public void WatchForActivationRequests(Action onActivateRequested, CancellationToken stoppingToken)
    {
        var thread = new Thread(() =>
        {
            var handles = new WaitHandle[] { _activateEvent, stoppingToken.WaitHandle };
            while (!stoppingToken.IsCancellationRequested)
            {
                var signaled = WaitHandle.WaitAny(handles);
                if (signaled == 0)
                {
                    onActivateRequested();
                }
            }
        })
        {
            IsBackground = true,
            Name = "LogExplorer.ActivationWatcher",
        };
        thread.Start();
    }

    public void Dispose()
    {
        if (IsFirstInstance)
        {
            _mutex.ReleaseMutex();
        }
        _mutex.Dispose();
        _activateEvent.Dispose();
    }
}
