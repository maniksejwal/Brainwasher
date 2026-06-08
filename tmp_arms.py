import sys
sys.path.insert(0, 'tensornets')
from tensornets.a3c.arms import (
    PhysioLLMWorker, PhysioLLMCoTMCTSWorker, PhysioMPSMCTSWorker,
    InertialPhysioMPSMCTSWorker, InertialPhysioLLMCoTMCTSWorker,
    OldschoolWorker, InertialHPVOOTPhysioMPSMCTSWorker, InertialHPVOOTPhysioLLMCoTMCTSWorker
)
workers = [
    PhysioLLMWorker, PhysioLLMCoTMCTSWorker, PhysioMPSMCTSWorker,
    InertialPhysioMPSMCTSWorker, InertialPhysioLLMCoTMCTSWorker, OldschoolWorker,
    InertialHPVOOTPhysioMPSMCTSWorker, InertialHPVOOTPhysioLLMCoTMCTSWorker
]
for i, w in enumerate(workers):
    arm = getattr(w, 'arm_name', None) or getattr(w, 'ARM_NAME', None) or '???'
    print(f'Exp {i} (--arms {i+1}): {w.__name__:<45} arm_name={arm!r}')
