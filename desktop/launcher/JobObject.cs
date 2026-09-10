using System.Runtime.InteropServices;

namespace LogExplorer.Launcher;

/// <summary>
/// Legacy Remediation Slice 9 §F: a Windows Job Object configured with
/// <c>JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE</c> - the OS itself terminates
/// every process assigned to it the moment this job handle closes (i.e.
/// the moment this launcher process ends, for *any* reason: a normal
/// exit, a crash, or an external force-kill). This is defense in depth
/// on top of <see cref="BackendProcessManager"/>'s own graceful
/// <c>Shutdown()</c> call from <c>FormClosed</c> - that path handles the
/// documented "closing the main window" flow; this one is what actually
/// guarantees "no orphan java.exe" even if the launcher itself is killed
/// abruptly (confirmed necessary by a real packaged-Windows-smoke-test
/// failure: force-killing the launcher process left its spawned backend
/// running, since a forceful termination bypasses <c>FormClosed</c>
/// entirely - that is what "force" means on any OS).
/// </summary>
internal sealed class JobObject : IDisposable
{
    private readonly SafeJobHandle _handle;

    private JobObject(SafeJobHandle handle)
    {
        _handle = handle;
    }

    public static JobObject CreateKillOnCloseJob()
    {
        var handle = CreateJobObject(IntPtr.Zero, null);
        if (handle.IsInvalid)
        {
            throw new InvalidOperationException("CreateJobObject failed.");
        }

        var info = new JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        var extendedInfo = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            BasicLimitInformation = info,
        };

        var length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        var extendedInfoPtr = Marshal.AllocHGlobal(length);
        try
        {
            Marshal.StructureToPtr(extendedInfo, extendedInfoPtr, false);
            if (!SetInformationJobObject(handle, JobObjectExtendedLimitInformation, extendedInfoPtr, (uint)length))
            {
                throw new InvalidOperationException("SetInformationJobObject failed.");
            }
        }
        finally
        {
            Marshal.FreeHGlobal(extendedInfoPtr);
        }

        return new JobObject(handle);
    }

    /// <summary>Assigns a process to this job - from then on, the OS kills it automatically when this job's handle closes.</summary>
    public void Assign(IntPtr processHandle)
    {
        if (!AssignProcessToJobObject(_handle, processHandle))
        {
            // A process that has already exited by the time this runs is
            // not a real failure worth surfacing - the process is gone
            // either way, which is the outcome this class exists for.
        }
    }

    public void Dispose() => _handle.Dispose();

    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public nuint MinimumWorkingSetSize;
        public nuint MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public nuint Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public nuint ProcessMemoryLimit;
        public nuint JobMemoryLimit;
        public nuint PeakProcessMemoryUsed;
        public nuint PeakJobMemoryUsed;
    }

    private sealed class SafeJobHandle : Microsoft.Win32.SafeHandles.SafeHandleZeroOrMinusOneIsInvalid
    {
        public SafeJobHandle() : base(true)
        {
        }

        protected override bool ReleaseHandle() => CloseHandle(handle);
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeJobHandle CreateJobObject(IntPtr lpJobAttributes, string? lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        SafeJobHandle hJob, int JobObjectInfoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(SafeJobHandle hJob, IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);
}
