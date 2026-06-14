import AlbireoApp from './albireo/AlbireoApp';
import AuthGate from './components/AuthGate';

export default function App() {
  return (
    <AuthGate>
      <AlbireoApp />
    </AuthGate>
  );
}
